import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Upload, X } from 'lucide-react';
import api from '@/lib/axios';
import { computeCompleteness } from '@/lib/completeness';
import { artistPath } from '@/lib/handle';
import { useAuthStore } from '@/stores/authStore';
import type { Portfolio } from '@/types';

/**
 * 작가 온보딩 — 처음엔 3단계 안내, 그 뒤엔 5칸 완성도 체크리스트 (2026-09-16)
 *
 * - 작품이 0점이면 **환영 패널**: "작품 올리기 → 이름·한 줄 소개 → 홈페이지 보기". 가입 직후 프로필 폼에
 *   떨어지던 것을 바꿨다 — 가치가 보이는 행동(업로드)을 먼저 시키고 정보는 그 뒤에 조금씩 받는다.
 * - 작품이 있으면 **체크리스트**: 작품 3점 · 작품 정보 · 작가노트 · 약력 · 공개. 다 채우면 사라진다.
 * - [나중에] 는 이 세션에서만 접는다(sessionStorage). 다음에 들어오면 다시 보인다 — 완성 전까지는 잊히면 안 된다.
 *
 * 마이페이지의 작가 탭(프로필·홈페이지 편집·포트폴리오·ArtLook) 위에 붙는다. 갤러리·Admin 에겐 없다.
 */
const DISMISS_KEY = 'artlink-checklist-dismissed';

export default function ArtistChecklist() {
  const { user } = useAuthStore();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const { data: portfolio, isLoading } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
    enabled: user?.role === 'ARTIST',
  });
  if (user?.role !== 'ARTIST' || isLoading || !portfolio || dismissed) return null;

  const c = computeCompleteness({ images: portfolio.images ?? [], statement: portfolio.statement, biography: portfolio.biography });
  if (c.complete) return null;

  const dismiss = () => { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* 저장소 못 쓰면 이번 렌더만 */ } setDismissed(true); };
  const works = portfolio.images?.length ?? 0;

  // ── 환영 패널: 작품 0점 ──
  if (works === 0) {
    return (
      <section className="mb-8 border border-gray-900 p-5 md:p-6" aria-label="시작하기">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">시작하기</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">작품 사진을 올리면 홈페이지가 바로 생깁니다</h2>
        {/* 단계 이름만 — 단계마다 붙던 작은 설명은 2026-09-16 사용자 요청으로 뺐다(체크리스트와 같은 이유) */}
        <ol className="mt-4 grid gap-3 sm:grid-cols-3">
          {['작품 사진 올리기', '이름 아래 한 줄', '홈페이지 보기'].map((t, i) => (
            <li key={t} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-gray-900 text-xs font-semibold">{i + 1}</span>
              <p className="text-sm font-medium">{t}</p>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Link to="/mypage?tab=homepage-edit#artworks" className="inline-flex items-center gap-2 bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700">
            <Upload size={15} /> 작품 올리기
          </Link>
          <button onClick={dismiss} className="text-sm text-gray-400 hover:text-gray-900">나중에</button>
        </div>
      </section>
    );
  }

  // ── 체크리스트 ──
  return (
    <section className="mb-8 border border-gray-200 p-5 md:p-6" aria-label="홈페이지 완성도">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-400">홈페이지 완성도</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{c.done}/{c.total} 완료 · {c.percent}%</h2>
        </div>
        <div className="flex items-center gap-3">
          {user && (
            <Link to={artistPath({ id: user.id, handle: user.handle })} className="inline-flex min-h-[44px] items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
              <ExternalLink size={13} /> 내 홈페이지
            </Link>
          )}
          <button onClick={dismiss} aria-label="나중에" className="-m-2 flex h-11 w-11 items-center justify-center text-gray-300 hover:text-gray-900"><X size={16} /></button>
        </div>
      </div>
      <div className="mt-3 h-1 w-full bg-gray-100"><div className="h-1 bg-gray-900 transition-all" style={{ width: `${c.percent}%` }} /></div>
      <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {c.items.map((it) => (
          <li key={it.key} className="flex items-start gap-2.5">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${it.done ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300'}`}>
              {it.done && <Check size={11} strokeWidth={3} />}
            </span>
            <div className="min-w-0">
              {it.done ? (
                <p className="text-sm text-gray-400 line-through">{it.label}</p>
              ) : (
                // 항목 이름만 — 그 아래 작은 설명("갤러리가 가장 먼저 읽는 글입니다" 등)은 2026-09-16 사용자 요청으로 뺐다.
                // 이름이 곧 할 일이라 설명은 잔소리였다. `why` 는 툴팁으로만 남긴다.
                <Link to={it.href} title={it.why} className="text-sm font-medium text-gray-900 hover:underline underline-offset-4">
                  {it.label}{it.progress && <span className="ml-1.5 text-xs font-normal text-gray-400">{it.progress}</span>}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
