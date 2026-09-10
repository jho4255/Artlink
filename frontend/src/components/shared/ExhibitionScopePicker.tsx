/**
 * 공고를 어디까지 진행할지 고르는 칸 — 갤러리 등록 폼과 아트링크 주최 폼이 **같이 쓴다**.
 *
 * 두 화면에 따로 만들면 문구가 갈라지고, 한쪽만 고치면 같은 기능이 화면마다 다르게 설명된다.
 * (마이페이지 메뉴를 `lib/myPageMenu.ts` 한 곳에 둔 것과 같은 이유)
 *
 * ⚠️ **고르고 나면 무엇이 사라지는지 적어 줄 것.** '공모만 진행'은 자료제출·전시 운영·정산이
 *    통째로 없어지는 선택인데, 이름만 봐서는 그게 안 보인다. 등록 뒤에 운영 페이지를 열고서야
 *    "정산 탭이 왜 없지" 하게 된다.
 *
 * @see backend/src/lib/exhibitionStage.ts — 서버가 뒷 단계 라우트를 400 으로 막는 곳
 */
import { ClipboardCheck, Layers } from 'lucide-react';

const OPTIONS = [
  {
    value: false,
    icon: Layers,
    label: '전시까지 진행',
    desc: '지원 → 수락 → 자료제출 → 전시 → 정산',
    note: '작가 출품자료를 받고 전시 운영·판매 정산까지 이 페이지에서 합니다.',
  },
  {
    value: true,
    icon: ClipboardCheck,
    label: '공모만 진행',
    desc: '지원 → 수락에서 끝',
    note: '지원자를 선정하는 것까지만 합니다. 자료제출·전시 운영·정산 단계가 생기지 않습니다.',
  },
] as const;

export default function ExhibitionScopePicker({
  recruitOnly,
  onChange,
  disabled,
}: {
  recruitOnly: boolean;
  onChange: (next: boolean) => void;
  /** 등록 뒤에는 못 바꾼다 — 이미 진행 중인 단계를 없애면 작가가 낸 자료가 갈 곳을 잃는다 */
  disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs font-medium text-gray-500">진행 범위 *</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const active = opt.value === recruitOnly;
          const Icon = opt.icon;
          return (
            <button
              key={String(opt.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`min-w-0 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? 'border-gray-900 bg-gray-900/[0.03]' : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Icon size={14} className={active ? 'text-gray-900' : 'text-gray-400'} />
                <span className={`text-sm ${active ? 'font-medium text-gray-900' : 'text-gray-600'}`}>{opt.label}</span>
              </span>
              <span className="mt-1 block text-[11px] text-gray-500">{opt.desc}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-gray-400">{opt.note}</span>
            </button>
          );
        })}
      </div>
      {recruitOnly && (
        <p className="mt-2 text-[11px] text-gray-500">
          공모 상세 페이지에 <b>“공모만 진행”</b>이라고 표시되어, 지원 작가도 어디까지 진행되는지 미리 알 수 있습니다.
        </p>
      )}
    </div>
  );
}
