import { useRef, useState } from 'react';
import { Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, Presentation, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { cn } from '@/lib/utils';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_MAX, attachmentFileProblem, attachmentKind, attachmentTypeLabel, formatFileSize,
  type AttachmentKind, type ExhibitionAttachment,
} from '@/lib/attachments';

/**
 * 공모 첨부파일 (2026-10-08) — 보여 주기(`AttachmentList`, 공고 상세·관리자 승인)와 붙이기(`AttachmentEditor`, 등록 폼·상세 고치기).
 * 규칙은 `lib/attachments.ts`. 누구나(비회원 포함) 내려받는다.
 */

const ICONS: Record<AttachmentKind, typeof File> = {
  pdf: FileText, hwp: FileText, doc: FileText, sheet: FileSpreadsheet, slide: Presentation, zip: FileArchive, image: FileImage, file: File,
};

function AttachmentIcon({ name }: { name: string }) {
  const Icon = ICONS[attachmentKind(name)];
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gray-100 text-gray-500" aria-hidden>
      <Icon size={17} />
    </span>
  );
}

function meta(a: ExhibitionAttachment) {
  const size = formatFileSize(a.size);
  return size ? `${attachmentTypeLabel(a.name)} · ${size}` : attachmentTypeLabel(a.name);
}

/**
 * 내려받기 목록.
 * ⚠️ `download` 이름은 **같은 출처**(로컬 `/uploads/`)에서만 먹는다 — 운영 파일은 R2(다른 출처)라 브라우저가 무시한다.
 *    그래서 서버가 R2 에 올릴 때 원래 이름을 Content-Disposition 으로 함께 적는다(backend `attachmentDisposition`).
 *    새 탭(target)은 그 헤더가 없는 옛 파일·PDF 가 이 페이지를 덮지 않게.
 */
export function AttachmentList({ items, className }: { items: ExhibitionAttachment[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cn('divide-y divide-gray-100 border-y border-gray-200', className)} aria-label="첨부파일">
      {items.map((a) => (
        <li key={a.url}>
          <a
            href={a.url}
            download={a.name}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[56px] items-center gap-3 px-1 py-2.5 transition-colors hover:bg-gray-50"
          >
            <AttachmentIcon name={a.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-gray-900">{a.name}</span>
              <span className="block text-xs text-gray-500">{meta(a)}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-sm text-gray-600">
              <Download size={15} aria-hidden />
              <span className="hidden sm:inline">내려받기</span>
              <span className="sr-only sm:hidden">{a.name} 내려받기</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * 붙이기 — 여러 파일을 고르면 **한 장씩 차례로** 올린다(서버는 동시에 3개까지만 처리한다).
 * ⚠️ `onChange` 는 함수형 갱신만 받는다 — 올리는 20~30초 동안 다른 칸을 고쳐도 덮지 않게, 또 여러 장이 이어 붙도록
 *    (규칙 50: 렌더 시점의 배열에 붙였더니 마지막 한 장만 남았다).
 */
export function AttachmentEditor({ value, onChange, disabled, onBusyChange, inputId }: {
  value: ExhibitionAttachment[];
  onChange: (update: (prev: ExhibitionAttachment[]) => ExhibitionAttachment[]) => void;
  disabled?: boolean;
  /** 올리는 중인지 — 부모가 [저장]·[등록]을 잠근다(다 올라가기 전에 저장하면 그 파일이 빠진다) */
  onBusyChange?: (busy: boolean) => void;
  inputId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; n: number; total: number } | null>(null);
  const busy = !!progress;

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = '';   // 같은 파일을 다시 고를 수 있게
    if (files.length === 0) return;
    const room = ATTACHMENT_MAX - value.length;
    if (room <= 0) {
      toast.error(`첨부파일은 ${ATTACHMENT_MAX}개까지 붙일 수 있어요.`);
      return;
    }
    const problems: string[] = [];
    const ok = files.filter((f) => {
      const p = attachmentFileProblem(f);
      if (p) problems.push(p);
      return !p;
    });
    const todo = ok.slice(0, room);
    if (ok.length > room) problems.push(`${ATTACHMENT_MAX}개까지라 ${ok.length - room}개는 빼고 올렸어요.`);

    onBusyChange?.(true);
    try {
      for (let i = 0; i < todo.length; i++) {
        const file = todo[i]!;
        setProgress({ name: file.name, n: i + 1, total: todo.length });
        try {
          const form = new FormData();
          form.append('file', file);
          // 큰 파일은 휴대폰에서 15초(기본 시간 제한)를 넘는다
          const { data } = await api.post('/upload/attachment', form, { timeout: 120_000 });
          onChange((prev) => (prev.length >= ATTACHMENT_MAX || prev.some((a) => a.url === data.url)
            ? prev
            : [...prev, { url: data.url, name: data.originalName || file.name, size: typeof data.size === 'number' ? data.size : file.size }]));
        } catch (err: any) {
          problems.push(`${file.name} — ${err?.response?.data?.error || '올리지 못했어요. 다시 시도해 주세요.'}`);
        }
      }
    } finally {
      setProgress(null);
      onBusyChange?.(false);
    }
    if (problems.length) toast.error(problems.join('\n'), { duration: 6000 });
  };

  return (
    <div>
      {(value.length > 0 || busy) && (
        <ul className="mb-2 divide-y divide-gray-100 rounded-lg border border-gray-200" aria-label="붙인 파일">
          {value.map((a) => (
            <li key={a.url} className="flex items-center gap-3 px-3 py-2">
              <AttachmentIcon name={a.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-900">{a.name}</span>
                <span className="block text-xs text-gray-500">{meta(a)}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange((prev) => prev.filter((x) => x.url !== a.url))}
                disabled={disabled}
                aria-label={`${a.name} 빼기`}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </li>
          ))}
          {progress && (
            <li className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600" role="status">
              <Loader2 size={16} className="shrink-0 animate-spin text-gray-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                올리는 중{progress.total > 1 ? ` (${progress.n}/${progress.total})` : ''} · {progress.name}
              </span>
            </li>
          )}
        </ul>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || value.length >= ATTACHMENT_MAX}
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 transition-colors hover:border-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip size={15} aria-hidden /> 파일 첨부
        <span className="text-xs tabular-nums text-gray-400">{value.length}/{ATTACHMENT_MAX}</span>
      </button>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        data-testid="attachment-input"
        onChange={(e) => { void pick(e.target.files); }}
      />
    </div>
  );
}
