import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import type { CustomField, CustomAnswer } from '@/types';

const ARTIST_APPLY_TERMS_VERSION = 'artist_apply_2026-07-03';

/**
 * 초대 간편 지원 모달
 *
 * 갤러리가 둘러보기에서 작품을 보고 직접 부른 것이므로 지원서를 다시 쓰게 하지 않는다.
 * 약력·경력·작품사진·포트폴리오 파일은 서버가 **작가의 포트폴리오에서 그대로 가져와** 첨부한다
 * (`POST /exhibitions/:id/apply` 의 `viaInvite: true` 경로).
 *
 * 다만 두 가지는 그대로 받는다.
 *  - **약관 동의**: 법적 요건이라 생략할 수 없다.
 *  - **필수 추가질문**: 갤러리가 직접 물은 항목이라 초대라고 건너뛰면 갤러리가 필요한 정보를 잃는다.
 *    추가질문이 없는 공모면 약관 체크 한 번으로 끝난다.
 *
 * 지원 후 상태는 평소와 같은 '접수' — 수락/거절은 갤러리가 결정한다(자동 수락 아님).
 *
 * 마이페이지 '받은 초대'와 공모 상세 페이지 두 곳에서 쓴다.
 */
interface Props {
  exhibitionId: number;
  exhibitionTitle: string;
  galleryName: string;
  customFields?: CustomField[] | null;
  onClose: () => void;
  onApplied?: () => void;
}

export default function InviteApplyModal({
  exhibitionId, exhibitionTitle, galleryName, customFields, onClose, onApplied,
}: Props) {
  const queryClient = useQueryClient();
  const [terms, setTerms] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const fields = customFields ?? [];

  // 지원 약관 텍스트 로드 (공모 상세의 지원 모달과 동일 파일)
  useEffect(() => {
    fetch('/terms/artist_apply_real.txt')
      .then(r => {
        if (!r.ok || r.headers.get('content-type')?.includes('text/html')) throw new Error('not text');
        return r.text();
      })
      .then(text => {
        if (!text.trimStart().startsWith('<!') && !text.trimStart().startsWith('<html')) setTerms(text);
      })
      .catch(() => setTerms('이 공모에 지원하시겠습니까? 포트폴리오가 갤러리에 전송됩니다.'));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const applyMutation = useMutation({
    mutationFn: () => {
      const customAnswers: CustomAnswer[] = fields
        .map(f => ({ fieldId: f.id, value: answers[f.id] ?? (f.type === 'multiselect' ? [] : '') }))
        .filter(a => (Array.isArray(a.value) ? a.value.length > 0 : String(a.value).trim() !== ''));
      return api.post(`/exhibitions/${exhibitionId}/apply`, {
        viaInvite: true,
        termsAgreed: true,
        termsVersion: ARTIST_APPLY_TERMS_VERSION,
        ...(customAnswers.length ? { customAnswers } : {}),
      });
    },
    onSuccess: () => {
      toast.success('지원이 접수되었습니다. 갤러리가 수락 여부를 알려드립니다.');
      queryClient.invalidateQueries({ queryKey: ['received-invites'] });
      queryClient.invalidateQueries({ queryKey: ['my-applications'] });
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibitionId)] });
      onApplied?.();
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || '지원에 실패했습니다.');
    },
  });

  const missingRequired = fields.some(f => {
    if (!f.required) return false;
    const v = answers[f.id];
    return Array.isArray(v) ? v.length === 0 : !String(v ?? '').trim();
  });

  const toggleMulti = (field: CustomField, option: string) => {
    setAnswers(prev => {
      const cur = Array.isArray(prev[field.id]) ? (prev[field.id] as string[]) : [];
      const next = cur.includes(option) ? cur.filter(o => o !== option) : [...cur, option];
      const max = field.maxSelect ?? 0;
      if (max > 0 && next.length > max) return prev;
      return { ...prev, [field.id]: next };
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-lg font-medium text-gray-900">간편 지원</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 cursor-pointer" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs text-gray-400">{galleryName}</p>
            <p className="text-base font-medium text-gray-900 break-keep">{exhibitionTitle}</p>
          </div>

          <div className="bg-gray-50 rounded p-3 text-sm text-gray-600">
            초대받은 공모라 <span className="font-medium text-gray-900">지원서를 다시 작성하지 않습니다.</span>
            <br />
            내 포트폴리오의 약력·경력·작품 사진이 그대로 전달됩니다.
            <p className="text-xs text-gray-400 mt-1.5">
              지원 후에는 갤러리가 수락 여부를 결정합니다.
            </p>
          </div>

          {/* 갤러리가 직접 물은 추가 질문은 초대여도 받는다 */}
          {fields.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-900">추가 질문</p>
              {fields.map(field => (
                <div key={field.id}>
                  <label className="block text-sm text-gray-700 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-[#c4302b] ml-0.5">*</span>}
                  </label>

                  {field.type === 'select' && (field.maxSelect ?? 1) === 1 ? (
                    <div className="space-y-1">
                      {(field.options ?? []).map(opt => (
                        <label key={opt} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                          <input
                            type="radio"
                            name={field.id}
                            checked={answers[field.id] === opt}
                            onChange={() => setAnswers(prev => ({ ...prev, [field.id]: opt }))}
                            className="cursor-pointer"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  ) : field.type === 'select' || field.type === 'multiselect' ? (
                    <div className="space-y-1">
                      {(field.options ?? []).map(opt => {
                        const cur = Array.isArray(answers[field.id]) ? (answers[field.id] as string[]) : [];
                        const max = field.maxSelect ?? 0;
                        const disabled = max > 0 && cur.length >= max && !cur.includes(opt);
                        return (
                          <label
                            key={opt}
                            className={`flex items-center gap-2 text-sm cursor-pointer ${disabled ? 'text-gray-300' : 'text-gray-600'}`}
                          >
                            <input
                              type="checkbox"
                              checked={cur.includes(opt)}
                              disabled={disabled}
                              onChange={() => toggleMulti(field, opt)}
                              className="cursor-pointer"
                            />
                            {opt}
                          </label>
                        );
                      })}
                      {(field.maxSelect ?? 0) > 0 && (
                        <p className="text-xs text-gray-400">최대 {field.maxSelect}개 선택</p>
                      )}
                    </div>
                  ) : (
                    <textarea
                      value={String(answers[field.id] ?? '')}
                      onChange={e => {
                        const max = field.maxLength ?? 0;
                        const v = max > 0 ? e.target.value.slice(0, max) : e.target.value;
                        setAnswers(prev => ({ ...prev, [field.id]: v }));
                      }}
                      rows={(field.maxLength ?? 0) > 200 ? 4 : 2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-1 focus:ring-gray-400"
                      placeholder="답변을 입력해주세요"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 약관 동의 — 초대여도 생략 불가 */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="max-h-32 overflow-y-auto p-3 bg-white text-xs text-gray-600 whitespace-pre-wrap">
              {terms || '약관 로딩 중...'}
            </div>
            <label className="flex items-center gap-2 p-3 bg-gray-100 border-t border-gray-200 cursor-pointer text-sm">
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="rounded cursor-pointer" />
              위 약관에 동의합니다
            </label>
          </div>

          <button
            onClick={() => applyMutation.mutate()}
            disabled={!agreed || missingRequired || applyMutation.isPending}
            className="w-full py-2.5 bg-gray-900 text-white text-sm disabled:bg-gray-300 cursor-pointer disabled:cursor-not-allowed"
          >
            {applyMutation.isPending ? '지원 중…' : '지원하기'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
