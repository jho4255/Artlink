import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import QRCode from 'qrcode';

/**
 * QR 모달 — 작가 홈페이지 주소를 전시장 라벨·명함·인스타 프로필에 붙이라고 준다 (2026-09-16).
 * 브라우저에서 만든다(서버 왕복 없음). [이미지 저장]은 PNG 로 내려준다.
 */
export default function QrModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 640, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } })
      .then((d) => { if (alive) setPng(d); })
      .catch(() => { if (alive) setPng(null); });
    return () => { alive = false; };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="QR 코드">
      <div className="w-full max-w-sm bg-white p-6 text-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">QR</p>
            <p className="mt-1 truncate text-base font-semibold">{title}</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="-m-2 flex h-11 w-11 items-center justify-center text-gray-400 hover:text-gray-900"><X size={18} /></button>
        </div>
        <div className="mx-auto mt-4 flex aspect-square w-56 items-center justify-center bg-gray-50">
          {png ? <img src={png} alt={`${title} QR`} className="h-full w-full" /> : <span className="text-xs text-gray-400">만드는 중…</span>}
        </div>
        <p className="mt-3 break-all text-center text-xs text-gray-500">{url}</p>
        <p className="mt-1 text-center text-[11px] text-gray-400">전시장 캡션·명함·인스타 프로필에 붙이면 바로 이 페이지로 옵니다.</p>
        <div className="mt-5 flex justify-center gap-4 text-sm">
          {png && (
            <a href={png} download={`${title}-QR.png`} className="font-medium underline underline-offset-4 hover:text-accent">이미지 저장</a>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">닫기</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
