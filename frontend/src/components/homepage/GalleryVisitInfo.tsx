import type { ReactNode } from 'react';
import { instagramHref, mapHref, telHref } from '@/lib/homepageSite';

/**
 * 갤러리 홈페이지의 방문 정보(2026-11-14 규칙 82 → 2026-11-15 부품으로 꺼냄) — 시간 · 주소 [지도] · 전화 · 메일 · 인스타. 있는 것만.
 * 갤러리 홈페이지(`GalleryDetailPage`)와 갤러리 등록 미리보기가 **같이 쓴다** — 미리보기가 따로 흉내 내면 화면이 바뀔 때 혼자 낡는다.
 * '지금 열려 있어요'는 하지 않는다(관람 시간이 자유 글이라 판정할 수 없다).
 * `preview` 면 링크를 걸지 않는다(아직 없는 갤러리). `owner` 는 주인에게만 보이는 줄(정보 수정 등).
 */
export default function GalleryVisitInfo({ openHours, address, phone, email, instagramUrl, addressNote, owner, preview, className }: {
  openHours?: string | null;
  address: string;
  phone: string;
  email?: string | null;
  instagramUrl?: string | null;
  /** 주소 아래 한 줄 — 주인에게 '주소 다시 넣기' 같은 것 */
  addressNote?: ReactNode;
  owner?: ReactNode;
  preview?: boolean;
  className?: string;
}) {
  const ig = instagramHref(instagramUrl);
  return (
    <dl className={className ?? 'mt-7 grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 text-[14px]'} data-testid={preview ? undefined : 'gallery-visit-info'}>
      {openHours && (
        <>
          <dt className="text-[13px] text-gray-500">시간</dt>
          <dd className="min-w-0 text-gray-900 break-keep [overflow-wrap:anywhere]">{openHours}</dd>
        </>
      )}
      {address && (
        <>
          <dt className="text-[13px] text-gray-500">주소</dt>
          <dd className="min-w-0 text-gray-900 break-keep [overflow-wrap:anywhere]">
            {address}
            {preview ? (
              <span className="ml-2 text-[13px] text-gray-500 underline underline-offset-4">지도</span>
            ) : (
              <a href={mapHref(address)} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center text-[13px] text-gray-500 underline underline-offset-4 hover:text-gray-900">지도</a>
            )}
            {addressNote}
          </dd>
        </>
      )}
      {phone && (
        <>
          <dt className="text-[13px] text-gray-500">전화</dt>
          <dd className="min-w-0 text-gray-900">
            {preview ? phone : (
              <>
                {/* 휴대폰은 누르면 전화 — PC 는 번호 글자만 */}
                <a href={telHref(phone)} className="underline underline-offset-4 md:hidden">{phone}</a>
                <span className="hidden md:inline">{phone}</span>
              </>
            )}
          </dd>
        </>
      )}
      {email && (
        <>
          <dt className="text-[13px] text-gray-500">메일</dt>
          <dd className="min-w-0 break-all text-gray-900">{email}</dd>
        </>
      )}
      {ig && (
        <>
          <dt className="text-[13px] text-gray-500">인스타</dt>
          <dd className="min-w-0">
            {preview ? <span className="break-all text-gray-900">{instagramUrl}</span> : (
              <a href={ig} target="_blank" rel="noopener noreferrer" className="break-all text-gray-900 hover:underline underline-offset-4">{instagramUrl}</a>
            )}
          </dd>
        </>
      )}
      {owner && <dd className="col-start-2 flex flex-wrap gap-x-4">{owner}</dd>}
    </dl>
  );
}
