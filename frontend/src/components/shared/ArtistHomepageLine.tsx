import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { computeCompleteness } from '@/lib/completeness';
import { editHref } from '@/lib/homepageEdit';
import { useAuthStore } from '@/stores/authStore';
import CompletenessLine from '@/components/shared/CompletenessLine';
import TaskLine from '@/components/flow/TaskLine';
import type { Portfolio } from '@/types';

/**
 * 마이페이지 [프로필] 탭 위의 **한 줄** — 홈페이지에 남은 일 (2026-10-02, 사용자 결정)
 *
 * 예전엔 '홈페이지 완성도' 상자(`ArtistChecklist`: 진행 막대 + 5칸 목록, 작품 0점이면 3단계 '시작하기' 패널)가
 * 프로필·포트폴리오·ArtLook 세 탭 위에 붙어 있었다. 2026-10-01 에 로그인 팝업(`HomepageNudge`)이 생긴 뒤로는
 * 같은 말을 두 번 하는 셈이었고, PDF 를 만들러 온 [포트폴리오] 탭에서는 그 상자가 본 내용을 밀어내 **지저분했다**.
 *
 * 지금 입력을 유도하는 곳은 셋이다.
 *  1. 로그인 팝업 — 로그인할 때 한 번. 항목을 누르면 홈페이지 편집의 그 자리로 간다(`lib/homepageNudge.ts`).
 *  2. 홈페이지 편집 화면의 완성도 한 줄(`CompletenessLine`, 칩이 버튼).
 *  3. **이 줄** — [프로필] 탭에만. 팝업을 [나중에] 로 닫았거나 7일 숨긴 뒤에도 마이페이지에 들어오면 남은 일이 보인다.
 *
 * ⚠️ [포트폴리오]·[ArtLook] 탭에는 붙이지 않는다 — 그 탭들은 제 일을 하러 온 곳이고, 작품이 없을 때의 안내는 각자 갖고 있다
 *    ("홈페이지에서 작품 등록하기"). `homepageEditor.test.ts` 가 소스로 막는다.
 * ⚠️ 상자로 되돌리지 말 것 — 한 줄이다. 닫기 버튼도 두지 않는다(한 줄이라 가릴 것이 없고, 다 채우면 스스로 사라진다).
 *
 * 작품이 0점이면 칩 다섯을 늘어놓지 않는다 — 아직 아무것도 없는데 "작품 정보·작가노트·약력…" 을 보이면 숙제 목록이 된다.
 * 그땐 할 일이 하나뿐이다: 작품 올리기. 글은 짧게 둔다 — "작품 사진을 올리면 홈페이지가 바로 생깁니다" 는 휴대폰에서 두 줄로 꺾였다(실측 390px).
 */
export default function ArtistHomepageLine() {
  const { user } = useAuthStore();
  const { data: portfolio } = useQuery<Portfolio>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
    enabled: user?.role === 'ARTIST',
  });
  if (user?.role !== 'ARTIST' || !portfolio) return null;

  const images = portfolio.images ?? [];
  if (images.length === 0) {
    return (
      <TaskLine
        className="mb-6"
        to={editHref('works')}
        task={{ tone: 'attention', text: '아직 올린 작품이 없어요', action: '작품 올리기' }}
      />
    );
  }
  return (
    <CompletenessLine
      className="mb-6"
      completeness={computeCompleteness({ images, statement: portfolio.statement, biography: portfolio.biography, career: portfolio.career })}
    />
  );
}
