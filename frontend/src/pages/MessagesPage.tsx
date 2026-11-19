import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';
import { useAuthStore } from '@/stores/authStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useFillHeight } from '@/hooks/useFillHeight';
import { useScrollLock, useVisualViewport } from '@/hooks/useVisualViewport';
import { CHAT_WIDE_MEDIA } from '@/hooks/useChatBare';
import type { ChatSummary } from '@/lib/chatTypes';
import ChatList from '@/components/chat/ChatList';
import ChatRoom from '@/components/chat/ChatRoom';
import NeighborPicker from '@/components/chat/NeighborPicker';

/**
 * ArtTalk — 갠톡(1:1)과 단톡(공모방) (2026-11-19 개편. 계획 `scratchpad/arttalk-renewal/PLAN.md`, 목업 ①②⑥).
 *
 * 화면은 주소 하나로 정한다 — `/messages`(목록) · `/messages?chat=<id>`(그 방). 알림·푸시·운영 안내가 이 모양을 쓴다(바꾸지 말 것).
 *  · 휴대폰·태블릿(1024px 미만): 목록 ↔ 방. 방은 **대화 전용 화면**(상단바·탭바 없음 — `hooks/useChatBare.ts`)이고 높이는 보이는 영역(자판 위)
 *  · 넓은 화면: 상단바·오른쪽 메뉴 안에서 [목록 | 방] 두 칸이 화면 높이를 다 쓴다(회사 정보 푸터 없음)
 * 두 배치를 CSS 로 둘 다 그려 감추지 않는다(useMediaQuery 로 하나만) — 방이 두 벌 떠서 두 번 폴링한다.
 *
 * ## 뒤로가기
 * 목록에서 방을 열면 기록을 쌓고(`state.fromList`), 방의 [←] 는 그 기록을 되돌린다 — 예전엔 [←] 가 기록을 **쌓아서**
 * 기기 뒤로가기를 누르면 방으로 되돌아갔다(목록 ↔ 방 고리). 알림으로 바로 들어온 방의 [←] 는 목록으로 바꿔 끼운다.
 * 넓은 화면에서 방을 바꾸는 건 기록을 쌓지 않는다(뒤로가기가 방들을 거꾸로 훑지 않게).
 *
 * ## 방이 생기는 길목은 좁다(설계)
 * 갠톡은 그 사람을 보고 여는 곳(작가·갤러리 홈페이지·작품의 [문의하기])과 **서로 이웃**뿐 — 임의 검색으로 아무나 찾는 '새 대화'는 없다.
 * 단톡은 공모가 승인되면 서버가 만든다.
 */
export default function MessagesPage() {
  const { user } = useAuthStore();
  const myId = user?.id ?? 0;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get('chat')) || null;
  const wide = useMediaQuery(CHAT_WIDE_MEDIA);
  const [neighbor, setNeighbor] = useState(false);

  // ⚠️ staleTime 0 · 들어올 때마다 다시 — 전역 기본(5분)이면 다른 화면에서 보낸 대화가 5분 동안 목록에 없었다(2026-11-19 신고)
  const { data: chats = [], isLoading } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: () => api.get('/chats').then((r) => r.data),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // 목록이 보일 때만 돈다(휴대폰에서 방을 보는 동안은 방이 4초마다 받는다)
    refetchInterval: wide || !openId ? 10_000 : false,
  });

  const openRoom = (id: number) => navigate({ pathname: '/messages', search: `?chat=${id}` }, wide ? { replace: true } : { state: { fromList: true } });
  // 방에서 나온 방(숨기기·넓은 화면의 [←] 대신) — 넓은 화면의 '첫 방 열기'가 방금 나온 방을 다시 열지 않게(목록이 다시 오기 전엔 아직 거기 있다)
  const left = useRef<number | null>(null);
  const back = () => {
    if (wide) {
      /* ⚠️ 넓은 화면은 방을 바꿀 때 기록을 쌓지 않으므로 navigate(-1) 이면 **ArtTalk 밖으로** 나간다(숨기기를 누르면 이전 화면이 떴다).
         다음 방으로 바꿔 끼운다 */
      left.current = openId;
      const next = chats.find((c) => c.id !== openId);
      navigate(next ? { pathname: '/messages', search: `?chat=${next.id}` } : '/messages', { replace: true });
      return;
    }
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate('/messages', { replace: true });
  };

  // 넓은 화면에서 방을 안 골랐으면 첫 방을 연다(빈 오른쪽을 보여 주지 않게)
  useEffect(() => {
    if (!wide || openId) return;
    const first = chats.find((c) => c.id !== left.current);
    if (first) navigate({ pathname: '/messages', search: `?chat=${first.id}` }, { replace: true });
  }, [wide, openId, chats, navigate]);

  const picker = neighbor && (
    <NeighborPicker
      onClose={() => setNeighbor(false)}
      onOpened={(id) => { setNeighbor(false); openRoom(id); }}
    />
  );

  if (!wide) {
    if (openId) return <MobileRoom key={openId} chatId={openId} myId={myId} onBack={back} />;
    return (
      <div className="min-h-[60vh] pb-4">
        <ChatList chats={chats} loading={isLoading} myId={myId} role={user?.role} openId={null} wide={false} onOpen={openRoom} onNeighbor={() => setNeighbor(true)} />
        {picker}
      </div>
    );
  }
  return (
    <>
      <DesktopShell>
        <div className="min-h-0 overflow-hidden border-r border-gray-200">
          <ChatList chats={chats} loading={isLoading} myId={myId} role={user?.role} openId={openId} wide onOpen={openRoom} onNeighbor={() => setNeighbor(true)} />
        </div>
        <div className="min-h-0 min-w-0">
          {openId
            ? <ChatRoom key={openId} chatId={openId} myId={myId} wide onBack={back} />
            : <div className="flex h-full items-center justify-center p-10 text-sm text-gray-600">{isLoading ? '' : '대화를 고르세요.'}</div>}
        </div>
      </DesktopShell>
      {picker}
    </>
  );
}

/** 넓은 화면 — 상단바 아래부터 화면 바닥까지 두 칸 */
function DesktopShell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useFillHeight(ref, { min: 480, gap: 0 });
  return (
    <div ref={ref} style={height ? { height } : undefined} className="grid min-h-[480px] grid-cols-[340px_minmax(0,1fr)] [&>*]:min-w-0">
      {children}
    </div>
  );
}

/** 휴대폰 대화 전용 화면 — 보이는 영역(자판 위)에 맞춰 화면을 다 쓴다. 뒤 페이지는 잠근다 */
function MobileRoom({ chatId, myId, onBack }: { chatId: number; myId: number; onBack: () => void }) {
  const vv = useVisualViewport();
  useScrollLock();
  return (
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col bg-white"
      style={{ height: vv.height, transform: vv.offsetTop ? `translateY(${vv.offsetTop}px)` : undefined, paddingTop: 'env(safe-area-inset-top)' }}
    >
      <ChatRoom chatId={chatId} myId={myId} wide={false} onBack={onBack} />
    </div>
  );
}
