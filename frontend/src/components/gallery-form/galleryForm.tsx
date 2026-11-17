/**
 * 갤러리 등록 폼의 판단 — 남은 필수 칸 · 저장할 주소 · 미리보기(2026-11-15).
 * 미리보기는 갤러리 찾기 카드(`GalleryCard`·`GalleryRow`)와 갤러리 홈페이지의 방문 정보(`GalleryVisitInfo`)를 **그대로** 쓴다.
 * (컴포넌트 파일과 나눈 이유: 한 파일에서 컴포넌트와 함수를 함께 내보내면 개발 서버의 빠른 새로고침이 그 파일을 통째로 다시 불러온다)
 */
import SkeletonImage from '@/components/shared/SkeletonImage';
import GalleryVisitInfo from '@/components/homepage/GalleryVisitInfo';
import { regionLabels } from '@/lib/utils';
import type { MissingField } from '@/components/form/StickySubmitBar';
import type { Preview } from '@/components/form/PreviewPane';

export interface GalFormValues {
  name: string;
  /** 주소 — 주소 검색으로 고른 도로명 주소(또는 직접 친 주소) */
  address: string;
  /** 상세 주소(층·호수) — 저장할 땐 주소 뒤에 붙여 한 줄로(`fullAddress`) */
  addressDetail: string;
  phone: string;
  description: string;
  region: string;
  ownerName: string;
  mainImage: string;
  email: string;
  instagramUrl: string;
}

export const emptyGalleryForm: GalFormValues = {
  name: '', address: '', addressDetail: '', phone: '', description: '', region: 'SEOUL', ownerName: '', mainImage: '', email: '', instagramUrl: '',
};

/** 서버에 보낼 주소 한 줄 — 서버·이미 등록된 갤러리는 지금처럼 문자열 하나다 */
export function fullAddress(form: Pick<GalFormValues, 'address' | 'addressDetail'>): string {
  return [form.address.trim(), (form.addressDetail ?? '').trim()].filter(Boolean).join(' ');
}

/** 남은 필수 칸 — 폼 순서대로(하단 줄 '남은 필수'와 [등록 요청]이 같은 목록을 본다) */
export function galleryMissing(form: GalFormValues): MissingField[] {
  const m: MissingField[] = [];
  if (!form.name.trim()) m.push({ key: 'name', label: '갤러리 이름' });
  if (!form.description.trim()) m.push({ key: 'description', label: '한 줄 소개' });
  if (!form.address.trim()) m.push({ key: 'address', label: '주소' });
  if (!form.phone.trim()) m.push({ key: 'phone', label: '전화' });
  if (!form.ownerName.trim()) m.push({ key: 'ownerName', label: '대표자명' });
  return m;
}

/** 이메일 형식 — 서버(zod email)와 같은 정도로만 본다. 비어 있으면 통과(선택 칸) */
export function galleryEmailError(email: string): string | null {
  const v = email.trim();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : '이메일 형식이 올바르지 않아요.';
}

/**
 * 미리보기 — [갤러리 홈페이지] 첫 화면(사진 · 지역 · 이름 · 한 줄 소개 · 방문 정보). 승인된 뒤에 보인다.
 * 갤러리 찾기 카드는 미리 보여 주지 않는다(2026-11-15 사용자 결정 — 홈페이지만 보면 된다).
 */
export function galleryPreview(form: GalFormValues): Preview {
  const name = form.name.trim() || '갤러리 이름';
  const description = form.description.trim();
  const home = (
    <div>
      {form.mainImage && (
        <SkeletonImage src={form.mainImage} thumb="grid" alt="" className="aspect-[4/3] w-full" imgClassName="object-contain" blurFill />
      )}
      <p className={form.mainImage ? 'mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400' : 'text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400'}>{regionLabels[form.region] ?? form.region}</p>
      <p className="mt-2 text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-gray-900 break-keep [overflow-wrap:anywhere]">{name}</p>
      {description && <p className="mt-3 line-clamp-4 text-[14px] leading-relaxed text-gray-700 break-keep [overflow-wrap:anywhere]">{description}</p>}
      <GalleryVisitInfo
        preview
        address={fullAddress(form)}
        phone={form.phone.trim()}
        email={form.email.trim() || null}
        instagramUrl={form.instagramUrl.trim() || null}
        className="mt-5 grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-[13px]"
      />
    </div>
  );
  return { label: '갤러리 홈페이지', node: home };
}
