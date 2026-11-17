/**
 * 갤러리 등록 폼(2026-11-15) — `/galleries/new`. 순서 = 갤러리 홈페이지 첫 화면의 순서.
 *  1 기본 — 대표 사진(4:3, 자르지 않는다 — 카드·홈페이지와 같은 모양) · 갤러리 이름 · 한 줄 소개
 *  2 방문 정보 — 주소([주소 검색] → 시·도·구가 정확해져 카드의 '서울 종로구'와 지역 칸이 저절로 맞는다) · 전화 · 이메일 · 인스타그램
 *  3 확인용 · 공개 안 함 — 대표자명(예전엔 공개 칸 사이에 섞여 공개되는 줄 알았다)
 * 예전 폼은 '실제 상세 페이지에 보일 모습'이라며 바뀌기 전 상세를 흉내 냈다 — 지금 미리보기는 진짜 카드·방문 정보 부품이다(galleryForm.tsx).
 * 관람 시간·홈페이지 주소(@)는 받지 않는다 — 승인 뒤 홈페이지의 [정보 수정]에서(2026-11-15 사용자가 고르지 않은 안).
 * ⚠️ placeholder '갤러리명'·'주소'·'전화번호'·'대표자명'·'갤러리 한줄 소개' 는 E2E 07 이 이 이름으로 찾는다.
 */
import type { Dispatch, SetStateAction } from 'react';
import { Lock } from 'lucide-react';
import { FormSection, FormField } from '@/components/flow/FormParts';
import { HeroImageEdit } from '@/components/shared/EditableField';
import AddressField from '@/components/form/AddressField';
import { formInputCls } from '@/lib/formStyles';
import { REGION_CODES, regionLabels, cn } from '@/lib/utils';
import { galleryEmailError, type GalFormValues } from '@/components/gallery-form/galleryForm';

export function GalleryFormBody({ form, setForm, errors, clearError }: {
  form: GalFormValues;
  setForm: Dispatch<SetStateAction<GalFormValues>>;
  errors: Set<string>;
  clearError: (key: string) => void;
}) {
  const err = (k: string) => errors.has(k);
  const set = (patch: Partial<GalFormValues>) => setForm((prev) => ({ ...prev, ...patch }));
  const emailError = galleryEmailError(form.email);
  return (
    <div className="space-y-2">
      <FormSection n={1} title="기본">
        <div className="flex gap-4 sm:gap-6">
          <div className="w-[120px] shrink-0 sm:w-[200px]" data-field="mainImage">
            <HeroImageEdit fit="contain" value={form.mainImage} onChange={(url) => set({ mainImage: url })} onRemove={() => set({ mainImage: '' })} className="aspect-[4/3] w-full" label="대표 사진" />
          </div>
          <div className="min-w-0 flex-1" data-field="name">
            <FormField label="갤러리 이름 *" error={err('name')} htmlFor="gal-name">
              <input
                id="gal-name"
                value={form.name}
                data-form-error={err('name') || undefined}
                onChange={(e) => { set({ name: e.target.value }); clearError('name'); }}
                placeholder="갤러리명"
                className={formInputCls(err('name'))}
              />
            </FormField>
          </div>
        </div>
        <div className="mt-4" data-field="description">
          <FormField label="한 줄 소개 *" error={err('description')} htmlFor="gal-desc">
            <textarea
              id="gal-desc"
              rows={3}
              value={form.description}
              data-form-error={err('description') || undefined}
              onChange={(e) => { set({ description: e.target.value }); clearError('description'); }}
              placeholder="갤러리 한줄 소개"
              className={cn(formInputCls(err('description')), 'resize-y leading-relaxed')}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection n={2} title="방문 정보">
        <div className="space-y-4">
          <div data-field="address">
            <p className={cn('mb-1.5 text-sm font-medium', err('address') ? 'text-accent' : 'text-gray-800')}>주소 *</p>
            <AddressField
              idPrefix="gal-address"
              base={form.address}
              detail={form.addressDetail}
              error={err('address')}
              onChange={({ base, detail }) => { set({ address: base, addressDetail: detail }); clearError('address'); }}
              onRegion={(region) => set({ region })}
              detailAside={(
                <label className="flex shrink-0 items-center gap-2 text-sm text-gray-700">
                  <span>지역</span>
                  <select
                    aria-label="지역"
                    value={form.region}
                    onChange={(e) => set({ region: e.target.value })}
                    className={cn(formInputCls(), 'w-auto min-w-[6.5rem]')}
                  >
                    {REGION_CODES.map((r) => <option key={r} value={r}>{regionLabels[r]}</option>)}
                  </select>
                </label>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-field="phone">
              <FormField label="전화 *" error={err('phone')} htmlFor="gal-phone">
                <input
                  id="gal-phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone}
                  data-form-error={err('phone') || undefined}
                  onChange={(e) => { set({ phone: e.target.value }); clearError('phone'); }}
                  placeholder="전화번호"
                  className={formInputCls(err('phone'))}
                />
              </FormField>
            </div>
            <FormField label="이메일 (선택)" error={!!emailError} htmlFor="gal-email" hint={emailError ?? undefined}>
              <input
                id="gal-email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                value={form.email}
                onChange={(e) => set({ email: e.target.value })}
                placeholder="이메일 (선택)"
                className={formInputCls(!!emailError)}
              />
            </FormField>
          </div>
          <FormField label="인스타그램 (선택)" htmlFor="gal-instagram">
            <input
              id="gal-instagram"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form.instagramUrl}
              onChange={(e) => set({ instagramUrl: e.target.value })}
              placeholder="instagram.com/아이디 또는 @아이디"
              className={formInputCls()}
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection n={3} title="확인용" titleNote={<span className="inline-flex items-center gap-1"><Lock size={11} aria-hidden />공개 안 함</span>}>
        <div className="sm:max-w-sm" data-field="ownerName">
          <FormField label="대표자명 *" error={err('ownerName')} htmlFor="gal-owner">
            <input
              id="gal-owner"
              value={form.ownerName}
              data-form-error={err('ownerName') || undefined}
              onChange={(e) => { set({ ownerName: e.target.value }); clearError('ownerName'); }}
              placeholder="대표자명"
              className={formInputCls(err('ownerName'))}
            />
          </FormField>
        </div>
      </FormSection>
    </div>
  );
}
