import { useEffect } from 'react';
import { Star } from 'lucide-react';
import { ACCENTS, BACKGROUNDS, TEXTS, bestAccentKey, bestTextKey, recommendedAccentKeys, recommendedTextKeys } from '@/lib/portfolioColors';
import { FONT_PRESETS, ensurePortfolioFonts, needsWebFont } from '@/lib/portfolioFonts';
import type { HomepageThemeKeys } from '@/lib/homepageTheme';
import Thumb from '@/components/shared/Thumb';
import type { PortfolioImage } from '@/types';

/**
 * 홈페이지 스타일 — 배경·글자·강조·글꼴·대표작 (2026-09-16).
 *
 * PDF [포트폴리오] 탭의 색·글꼴 탭과 **같은 팔레트·같은 추천 규칙**(WCAG 대비)을 쓴다. 한 디자인, 두 출력.
 * 배경을 바꾸면 대비가 모자란 글자·강조는 추천값으로 바꿔 준다(PDF 피커의 `setBg` 와 같은 동작).
 *
 * 홈페이지 편집 › [꾸미기] 에 놓인다(2026-10-02). 그 전엔 편집 화면 **맨 위**라 가입 직후 첫 화면이 색 고르기였는데,
 * 실서버에서 직접 고른 작가가 0명이었다 — 선택 사항이라 맨 끝 묶음으로 보내고 대표작을 앞세웠다.
 */
const Swatch = ({ hex, label, active, recommended, onClick, ink }: { hex: string; label: string; active: boolean; recommended?: boolean; onClick: () => void; ink?: string }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    aria-pressed={active}
    className={`relative h-8 w-8 rounded-full border transition-shadow ${active ? 'ring-2 ring-offset-2 ring-gray-900 border-transparent' : 'border-gray-200 hover:ring-1 hover:ring-gray-300'}`}
    style={{ backgroundColor: hex || ink || '#1A1A1A' }}
  >
    {recommended && <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 ring-2 ring-white" />}
  </button>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start gap-3">
    <span className="w-10 shrink-0 pt-1.5 text-xs text-gray-500">{label}</span>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export default function HomepageStylePicker({ value, images, onChange }: {
  value: HomepageThemeKeys;
  images: PortfolioImage[];
  onChange: (next: HomepageThemeKeys) => void;
}) {
  const inkHex = TEXTS.find((t) => t.key === value.ink)?.hex;
  const okText = new Set(recommendedTextKeys(value.bg));
  const okAccent = new Set(recommendedAccentKeys(value.bg));
  const setBg = (bg: string) => {
    // 배경을 바꾸면 안 읽히는 조합을 조용히 추천값으로 — 고른 사람이 흰 글자를 흰 배경에 둘 리 없다
    const ink = recommendedTextKeys(bg).includes(value.ink) ? value.ink : bestTextKey(bg);
    const accent = recommendedAccentKeys(bg).includes(value.accent) ? value.accent : bestAccentKey(bg);
    onChange({ ...value, bg, ink, accent });
  };
  // 글꼴 칩을 제 글꼴로 보여주려면 웹폰트가 필요하다
  useEffect(() => { if (FONT_PRESETS.some((f) => needsWebFont(f.key))) ensurePortfolioFonts(); }, []);

  return (
    <div className="space-y-4">
      {/* 대표작이 먼저다 — 색·글꼴보다 홈페이지 얼굴을 더 많이 바꾼다(2026-10-02, 예전엔 스타일 상자 맨 아래 줄이었다) */}
      {images.length > 1 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-gray-800">대표작</p>
          <p className="mb-2 text-xs leading-relaxed text-gray-500">홈페이지 [작품] 탭 맨 위에 크게 놓이는 작품입니다. 안 고르면 첫 작품이 놓입니다.</p>
          <div className="flex flex-wrap gap-1.5">
            {images.map((img, i) => {
              const active = value.heroImageId ? value.heroImageId === img.id : i === 0;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onChange({ ...value, heroImageId: img.id })}
                  aria-pressed={active}
                  aria-label={`${i + 1}번째 작품을 대표작으로`}
                  title="대표작으로"
                  className={`relative h-14 w-14 overflow-hidden bg-gray-50 ${active ? 'ring-2 ring-offset-1 ring-gray-900' : 'opacity-80 hover:opacity-100'}`}
                >
                  <Thumb src={img.url} size="list" alt="" className="h-full w-full object-contain" />
                  {active && <Star size={12} className="absolute right-0.5 top-0.5 fill-white text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-800">색과 글꼴 <span className="ml-1 text-xs font-normal text-gray-500">포트폴리오 PDF 에도 같은 색·글꼴이 쓰입니다</span></p>
        <Row label="배경">
          {BACKGROUNDS.map((s) => <Swatch key={s.key} hex={s.hex} label={s.label} active={value.bg === s.key} onClick={() => setBg(s.key)} />)}
        </Row>
        <Row label="글자">
          {TEXTS.map((s) => <Swatch key={s.key} hex={s.hex} label={s.label} active={value.ink === s.key} recommended={okText.has(s.key)} onClick={() => onChange({ ...value, ink: s.key })} />)}
        </Row>
        <Row label="강조">
          {ACCENTS.map((s) => <Swatch key={s.key} hex={s.hex} ink={inkHex} label={s.label} active={value.accent === s.key} recommended={okAccent.has(s.key)} onClick={() => onChange({ ...value, accent: s.key })} />)}
        </Row>
        <Row label="글꼴">
          {FONT_PRESETS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onChange({ ...value, font: f.key })}
              aria-pressed={value.font === f.key}
              className={`rounded-full border px-3 py-1 text-sm ${value.font === f.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-400'}`}
              style={{ fontFamily: f.title }}
            >
              {f.label}
            </button>
          ))}
        </Row>
        {/* 초록 점이 무슨 뜻인지 어디에도 없었다 */}
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <span aria-hidden className="h-2 w-2 rounded-full bg-green-500" /> 고른 배경에서 잘 읽히는 색입니다. 배경을 바꾸면 안 읽히는 글자색은 알아서 바뀝니다.
        </p>
      </div>
    </div>
  );
}
