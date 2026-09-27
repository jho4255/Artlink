import { useState } from 'react';
import toast from 'react-hot-toast';
import { MultiImageUpload } from '@/components/shared/ImageUpload';
import LazyRichTextEditor from '@/components/shared/LazyRichTextEditor';
import { ARCHIVE_MAX_IMAGES, type ArchiveDraft } from '@/lib/galleryArchive';

/**
 * 지난 활동 기록 작성·수정 (2026-09-16, 갤러리 주인 전용).
 *
 * 필수는 **제목 하나**다 — 오래된 전시일수록 기억나는 게 제목뿐인 경우가 많은데 기간·장소까지 강제하면
 * 아예 안 적게 된다. 기간은 자유 텍스트("2025 가을")로 두고, 정렬용 날짜는 따로 고른다(선택).
 */
export default function GalleryArchiveForm({ draft, onChange, onSubmit, onCancel, saving }: {
  draft: ArchiveDraft;
  /**
   * ⚠️ 함수형 갱신만 받는다. 사진을 여러 장 고르면 업로더가 한 장마다 연달아 부르는데, 렌더 시점의 draft 에 붙이면
   * 앞 장들이 덮여 **마지막 한 장만 남았다**(2026-09-27 신고 "여러 장 한 번에 추가가 안 된다").
   */
  onChange: (update: (prev: ArchiveDraft) => ArchiveDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(!!(draft.venue || draft.date || draft.artists));
  const set = (patch: Partial<ArchiveDraft>) => onChange((prev) => ({ ...prev, ...patch }));
  const field = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400';

  return (
    <div className="mb-5 space-y-3 rounded-lg border border-gray-300 p-4">
      <p className="text-sm font-medium text-gray-900">지난 활동 기록</p>
      <p className="-mt-2 text-xs text-gray-500">
        아트링크에서 진행하지 않은 전시·아트페어도 여기에 적어 두면 갤러리 페이지에 남습니다. 작가가 갤러리를 고를 때 읽습니다.
      </p>

      <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="전시·행사 이름 *" className={field} />
      <input value={draft.period} onChange={(e) => set({ period: e.target.value })} placeholder="기간 (예: 2025.10.1 – 10.4, 2025 가을)" className={field} />

      {showAdvanced ? (
        <>
          <input value={draft.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="장소 (예: 서울 코엑스) — 우리 공간이면 비워 두세요" className={field} />
          <label className="block">
            <span className="text-xs text-gray-500">정렬용 날짜 (선택) — 비우면 등록한 순서로 놓입니다</span>
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} className={`${field} mt-1`} />
          </label>
          <input value={draft.artists} onChange={(e) => set({ artists: e.target.value })} placeholder="참여 작가 (쉼표로 구분, 회원이 아니어도 됩니다)" className={field} />
        </>
      ) : (
        <button onClick={() => setShowAdvanced(true)} className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-900">
          장소 · 날짜 · 참여 작가 적기
        </button>
      )}

      {/* 본문은 서식 있는 글(2026-09-28) — 서버가 허용 목록으로 거르고, 한도는 보이는 글자 4,000자 */}
      <LazyRichTextEditor
        value={draft.body}
        onChange={(html) => set({ body: html })}
        placeholder="어떤 전시였는지, 어떻게 진행됐는지 적어 주세요. (선택)"
        maxLength={4000}
        minHeight={120}
      />

      <div>
        <p className="mb-1.5 text-xs text-gray-500">사진 (최대 {ARCHIVE_MAX_IMAGES}장 · 여러 장을 한 번에 골라도 됩니다)</p>
        <MultiImageUpload
          images={draft.images.map((url) => ({ url }))}
          onAdd={(url) => onChange((prev) => ({ ...prev, images: [...prev.images, url].slice(0, ARCHIVE_MAX_IMAGES) }))}
          onRemove={(i) => onChange((prev) => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }))}
          maxCount={ARCHIVE_MAX_IMAGES}
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { if (!draft.title.trim()) { toast.error('전시·행사 이름을 입력해주세요.'); return; } onSubmit(); }}
          disabled={saving}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >{saving ? '저장 중…' : '저장'}</button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-500">취소</button>
      </div>
    </div>
  );
}
