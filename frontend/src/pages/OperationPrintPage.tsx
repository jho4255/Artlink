/**
 * OperationPrintPage — 작가 제출 문서 PDF 인쇄 화면
 * 경로: /exhibitions/:id/operation/print/:userId/:doc  (doc = artwork | cv | note)
 *
 * - 갤러리 오너 / Admin / 본인만 접근 (백엔드에서 검증)
 * - A4 인쇄 최적화 레이아웃. document.title = [공모명]_[작가명]_[문서종류] 로 설정 →
 *   브라우저 'PDF로 저장' 시 파일명 자동 제안. 데이터·이미지 로드 후 자동 인쇄창 호출.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { displayName } from '@/lib/utils';
import type { OperationSubmission, ArtistCv, CvEntry } from '@/types';

const DOC_LABEL: Record<string, string> = { artwork: '출품리스트', cv: '작가약력', note: '작가노트' };
const CV_SECTIONS: { key: keyof Pick<ArtistCv, 'solo' | 'group' | 'artFair' | 'award'>; label: string }[] = [
  { key: 'solo', label: '개인전' },
  { key: 'group', label: '단체전' },
  { key: 'artFair', label: '아트페어 / 옥션' },
  { key: 'award', label: '수상 및 선정' },
];

interface PrintData {
  exhibitionTitle: string;
  user: { id: number; name: string; nickname?: string | null; email?: string };
  submission: OperationSubmission;
}

export default function OperationPrintPage() {
  const { id, userId, doc } = useParams<{ id: string; userId: string; doc: string }>();
  const printedRef = useRef(false);
  const [ready, setReady] = useState(false);

  const { data, isLoading, error } = useQuery<PrintData>({
    queryKey: ['operation-print', id, userId],
    queryFn: () => api.get(`/operations/${id}/submissions/${userId}`).then(r => r.data),
    enabled: !!id && !!userId,
    retry: false,
  });

  const docType = doc || 'artwork';
  const docLabel = DOC_LABEL[docType] || '문서';

  // 파일명 설정 + 이미지 프리로드 후 자동 인쇄
  useEffect(() => {
    if (!data) return;
    const artist = displayName(data.user);
    document.title = `${data.exhibitionTitle}_${artist}_${docLabel}`;

    const imgs: string[] = docType === 'artwork'
      ? (data.submission.artworkList || []).map(a => a.image).filter(Boolean) as string[]
      : [];
    if (imgs.length === 0) { setReady(true); return; }
    let loaded = 0;
    const done = () => { loaded += 1; if (loaded >= imgs.length) setReady(true); };
    imgs.forEach(src => { const im = new Image(); im.onload = done; im.onerror = done; im.src = src; });
  }, [data, docType, docLabel]);

  useEffect(() => {
    if (ready && !printedRef.current) {
      printedRef.current = true;
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [ready]);

  if (isLoading) return <div className="p-10 text-center text-gray-400">불러오는 중...</div>;
  if (error || !data) return <div className="p-10 text-center text-gray-400">문서를 불러올 수 없습니다. (권한이 없거나 존재하지 않음)</div>;

  const artist = displayName(data.user);
  const { submission } = data;

  return (
    <div className="print-root">
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .print-root { max-width: 800px; margin: 0 auto; padding: 32px 24px 64px; color: #111; font-size: 13px; line-height: 1.6; }
        .pr-table { width: 100%; border-collapse: collapse; }
        .pr-table th, .pr-table td { border: 1px solid #ddd; padding: 8px; vertical-align: middle; }
        .pr-table th { background: #f5f5f5; font-weight: 600; font-size: 12px; }
      `}</style>

      {/* 인쇄 버튼 (화면에서만) */}
      <div className="no-print" style={{ position: 'sticky', top: 0, background: '#fff', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #eee', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => window.print()} style={{ background: '#111', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 13 }}>PDF로 저장 / 인쇄</button>
      </div>

      {/* 문서 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: '#888' }}>{data.exhibitionTitle}</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>{docLabel}</h1>
        <p style={{ fontSize: 13, color: '#444' }}>{artist}{data.user.email ? ` · ${data.user.email}` : ''}</p>
      </div>

      {docType === 'artwork' && <ArtworkDoc submission={submission} />}
      {docType === 'cv' && <CvDoc submission={submission} artist={artist} />}
      {docType === 'note' && <NoteDoc submission={submission} artist={artist} />}
    </div>
  );
}

function ArtworkDoc({ submission }: { submission: OperationSubmission }) {
  const list = submission.artworkList || [];
  if (list.length === 0) return <p style={{ color: '#999' }}>등록된 출품작이 없습니다.</p>;
  return (
    <table className="pr-table">
      <thead>
        <tr>
          <th style={{ width: 30 }}>No</th>
          <th style={{ width: 110 }}>Image</th>
          <th>Title</th>
          <th style={{ width: 110 }}>Size</th>
          <th style={{ width: 140 }}>Medium</th>
          <th style={{ width: 50 }}>Year</th>
          <th style={{ width: 90 }}>Price</th>
        </tr>
      </thead>
      <tbody>
        {list.map((a, i) => (
          <tr key={i}>
            <td style={{ textAlign: 'center' }}>{i + 1}</td>
            <td style={{ textAlign: 'center' }}>
              {a.image ? <img src={a.image} alt="" style={{ width: 90, height: 90, objectFit: 'cover' }} /> : <span style={{ color: '#bbb', fontSize: 11 }}>-</span>}
            </td>
            <td style={{ textAlign: 'center' }}>{a.title}</td>
            <td style={{ textAlign: 'center' }}>{a.size}</td>
            <td style={{ textAlign: 'center' }}>{a.medium}</td>
            <td style={{ textAlign: 'center' }}>{a.year}</td>
            <td style={{ textAlign: 'center' }}>{a.price}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CvDoc({ submission, artist }: { submission: OperationSubmission; artist: string }) {
  const cv = submission.cv;
  if (!cv) return <p style={{ color: '#999' }}>등록된 약력이 없습니다.</p>;
  const Section = ({ label, items }: { label: string; items: CvEntry[] }) => items.length === 0 ? null : (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', marginBottom: 6 }}>{label}</h2>
      {items.map((e, i) => (
        <p key={i} style={{ margin: '2px 0' }}>{e.year} {e.content}</p>
      ))}
    </div>
  );
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 16, fontWeight: 700 }}>{cv.nameKo || artist}</p>
        {cv.tel && <p>Tel  {cv.tel}</p>}
        {cv.email && <p>email  {cv.email}</p>}
      </div>
      {CV_SECTIONS.map(({ key, label }) => <Section key={key} label={label} items={cv[key]} />)}
    </div>
  );
}

function NoteDoc({ submission, artist }: { submission: OperationSubmission; artist: string }) {
  const note = submission.note;
  if (!note || (!note.statement && !(note.sections?.length))) return <p style={{ color: '#999' }}>등록된 작가노트가 없습니다.</p>;
  return (
    <div>
      <h2 style={{ textAlign: 'center', fontSize: 18, fontWeight: 700, marginBottom: 4 }}>작가노트</h2>
      <p style={{ textAlign: 'right', color: '#666', marginBottom: 20 }}>{artist}</p>
      {note.statement && <p style={{ whiteSpace: 'pre-wrap', marginBottom: 20 }}>{note.statement}</p>}
      {note.sections?.map((s, i) => (
        <div key={i} style={{ marginBottom: 18 }}>
          {s.title && <h3 style={{ fontSize: 15, fontWeight: 700, background: '#fdf3c4', display: 'inline-block', padding: '2px 6px', marginBottom: 8 }}>{s.title}</h3>}
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p>
        </div>
      ))}
    </div>
  );
}
