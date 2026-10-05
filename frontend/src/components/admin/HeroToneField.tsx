import { useEffect, useState } from 'react';
import { autoTones, loadHeroAnalysis, TEXT_TONE_LABELS, type HeroAnalysis, type TextTone } from '@/lib/heroTone';

export type HeroToneChoice = 'auto' | TextTone;

/** 올린 사진의 밝기 표 — 관리 화면에서 '자동이면 무엇이 되는가'를 미리 보여 준다 */
export function useHeroAutoTones(imageUrl: string) {
  const [a, setA] = useState<HeroAnalysis | null>(null);
  useEffect(() => {
    let alive = true;
    setA(null);
    if (imageUrl) void loadHeroAnalysis(imageUrl).then((r) => { if (alive) setA(r); });
    return () => { alive = false; };
  }, [imageUrl]);
  return autoTones(a);
}

/**
 * 히어로 슬라이드 — 사진 위 글자 색(자동 / 검정 / 흰색). 자동은 글자가 놓인 자리의 밝기로 고른다(lib/heroTone.ts).
 * 자동이 사진 속 그림에 걸려 틀릴 때만 고정하라고 적는다.
 */
export default function HeroToneField({ value, onChange, imageUrl }: { value: HeroToneChoice; onChange: (v: HeroToneChoice) => void; imageUrl: string }) {
  const auto = useHeroAutoTones(imageUrl);
  const name = (t: TextTone) => (t === 'black' ? '검은 글자' : '흰 글자');
  return (
    <fieldset>
      <legend className="text-sm font-medium text-gray-900">사진 위 글자 색</legend>
      <div className="mt-1.5 inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="radiogroup" aria-label="사진 위 글자 색">
        {(['auto', 'black', 'white'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`min-h-[40px] rounded-md px-3 text-sm ${value === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {TEXT_TONE_LABELS[v]}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {value === 'auto'
          ? auto
            ? `글자가 놓인 자리의 밝기로 정합니다. 이 사진이면 [자세히 보기]는 ${name(auto.btn)}, 제목은 ${name(auto.title)}예요.`
            : '글자가 놓인 자리의 밝기로 검정·흰색을 정합니다.'
          : '자세히 보기·제목·넘김 표시가 모두 이 색으로 나옵니다. 자동이 사진 속 그림에 걸려 잘 안 보일 때만 고르세요.'}
      </p>
    </fieldset>
  );
}
