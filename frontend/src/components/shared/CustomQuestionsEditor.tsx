import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import type { CustomField } from '@/types';

// 추가 질문(커스텀 필드) 편집기 — 공모 등록 폼과 게시 후 수정 모달에서 공유.
// 단일선택 = type:'select'(maxSelect 1), 다중선택 = type:'multiselect'('중복 선택 허용' 토글).
export function CustomQuestionBuilder({
  fields,
  onChange,
}: {
  fields: CustomField[];
  onChange: (updater: (fields: CustomField[]) => CustomField[]) => void;
}) {
  const isChoiceField = (field: CustomField) => field.type === 'select' || field.type === 'multiselect';
  const addQuestion = (type: 'textarea' | 'select') => {
    onChange((prev) => [
      ...prev,
      {
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        label: '',
        type,
        required: false,
        options: type === 'select' ? [''] : undefined,
        maxSelect: type === 'select' ? 1 : undefined,
      },
    ]);
  };
  const updateQuestion = (index: number, patch: Partial<CustomField>) => {
    onChange((prev) => prev.map((field, i) => i === index ? { ...field, ...patch } : field));
  };
  const removeQuestion = (index: number) => {
    onChange((prev) => prev.filter((_, i) => i !== index));
  };
  const updateOption = (fieldIndex: number, optionIndex: number, value: string) => {
    onChange((prev) => prev.map((field, i) => {
      if (i !== fieldIndex) return field;
      const options = [...(field.options ?? [])];
      options[optionIndex] = value;
      return { ...field, options };
    }));
  };
  const addOption = (fieldIndex: number) => {
    onChange((prev) => prev.map((field, i) => i === fieldIndex ? { ...field, options: [...(field.options ?? []), ''] } : field));
  };
  const removeOption = (fieldIndex: number, optionIndex: number) => {
    onChange((prev) => prev.map((field, i) => i === fieldIndex ? { ...field, options: (field.options ?? []).filter((_, oi) => oi !== optionIndex) } : field));
  };

  return (
    <div className="pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-xs font-medium text-gray-500">추가 질문</p>
          <p className="text-[11px] text-gray-400">작가 지원서에 객관식/주관식 질문을 추가할 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => addQuestion('textarea')} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">주관식</button>
          <button type="button" onClick={() => addQuestion('select')} className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">객관식</button>
        </div>
      </div>
      {fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-xs text-gray-400">
          필요한 경우 설치 가능 일정, 작품 운송 방식, 작가와의 협업 가능 여부 같은 질문을 추가하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div key={field.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-gray-500">
                  {isChoiceField(field) ? (field.type === 'multiselect' ? '객관식 · 중복 선택' : '객관식') : '주관식'}
                </span>
                <label className="flex items-center gap-1 text-[11px] text-gray-500">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                    className="rounded"
                  />
                  필수
                </label>
                <button type="button" onClick={() => removeQuestion(index)} className="ml-auto text-[11px] text-red-500 hover:underline">삭제</button>
              </div>
              <input
                value={field.label}
                onChange={(e) => updateQuestion(index, { label: e.target.value })}
                placeholder="질문을 입력하세요"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              {isChoiceField(field) && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                      <input
                        type="checkbox"
                        checked={field.type === 'multiselect'}
                        onChange={(e) => updateQuestion(index, {
                          type: e.target.checked ? 'multiselect' : 'select',
                          maxSelect: e.target.checked ? 0 : 1,
                        })}
                        className="rounded"
                      />
                      중복 선택 허용
                    </label>
                    {field.type === 'multiselect' && (
                      <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
                        최대
                        <input
                          type="number"
                          min={0}
                          max={(field.options ?? []).filter(Boolean).length || undefined}
                          value={field.maxSelect ?? 0}
                          onChange={(e) => updateQuestion(index, { maxSelect: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-16 rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                        />
                        개 선택 <span className="text-gray-400">(0=무제한)</span>
                      </label>
                    )}
                  </div>
                  {(field.options ?? []).map((option, optionIndex) => (
                    <div key={optionIndex} className="flex items-center gap-2">
                      <input
                        value={option}
                        onChange={(e) => updateOption(index, optionIndex, e.target.value)}
                        placeholder={`선택지 ${optionIndex + 1}`}
                        className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                      />
                      <button type="button" onClick={() => removeOption(index, optionIndex)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addOption(index)} className="text-xs text-gray-600 hover:underline">+ 선택지 추가</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 저장 전 정리: 라벨/선택지 trim + 빈 항목 제거, maxSelect 정규화(select=1, multiselect=옵션 수 이내).
export function sanitizeCustomFields(fields: CustomField[]): CustomField[] {
  return fields
    .map((field) => {
      const options = field.type === 'select' || field.type === 'multiselect'
        ? (field.options ?? []).map((option) => option.trim()).filter(Boolean)
        : undefined;
      const rawMaxSelect = field.maxSelect ?? 0;
      const maxSelect = field.type === 'select' ? 1 : field.type === 'multiselect'
        ? rawMaxSelect > 0 ? Math.min(rawMaxSelect, options?.length ?? 0) : 0
        : undefined;
      return {
        ...field,
        label: field.label.trim(),
        options,
        maxSelect,
      };
    })
    .filter((field) => field.label);
}

// 객관식은 선택지 2개 이상 필요 — 위반 시 에러 메시지 반환(없으면 null).
export function validateCustomFields(fields: CustomField[]): string | null {
  const invalid = fields.find((field) => (field.type === 'select' || field.type === 'multiselect') && (field.options ?? []).length < 2);
  if (invalid) return '객관식 질문은 선택지를 2개 이상 입력해주세요.';
  return null;
}

// 게시된 공고의 추가 질문 수정 모달 — 마이페이지/공고 상세 공용.
export default function CustomQuestionsEditModal({
  exhibitionId,
  exhibitionTitle,
  initialFields,
  onClose,
}: {
  exhibitionId: number;
  exhibitionTitle?: string;
  initialFields: CustomField[] | null | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<CustomField[]>(() =>
    (initialFields ?? []).map((f) => ({ ...f, options: f.options ? [...f.options] : f.options }))
  );

  const saveMutation = useMutation({
    mutationFn: (customFields: CustomField[]) =>
      api.patch(`/exhibitions/${exhibitionId}/custom-fields`, { customFields }),
    onSuccess: () => {
      // 상세/내 공모 목록 모두 갱신 (공용 모달이므로 관련 캐시 전부 무효화)
      queryClient.invalidateQueries({ queryKey: ['exhibition', String(exhibitionId)] });
      queryClient.invalidateQueries({ queryKey: ['my-exhibitions'] });
      queryClient.invalidateQueries({ queryKey: ['exhibitions'] });
      toast.success('추가 질문이 저장되었습니다.');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || '저장에 실패했습니다.'),
  });

  const handleSave = () => {
    const cleaned = sanitizeCustomFields(fields);
    const error = validateCustomFields(cleaned);
    if (error) { toast.error(error); return; }
    saveMutation.mutate(cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="text-lg font-medium text-gray-900">추가 질문 수정</h3>
            {exhibitionTitle && <p className="text-sm text-gray-400">{exhibitionTitle}</p>}
          </div>
          <button onClick={onClose} aria-label="닫기" className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          이미 지원한 작가의 기존 답변은 그대로 유지됩니다. 모집 진행 중에는 질문 변경에 유의하세요.
        </p>

        <CustomQuestionBuilder fields={fields} onChange={(updater) => setFields((prev) => updater(prev))} />

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500">취소</button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg disabled:opacity-50"
          >
            {saveMutation.isPending ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
