import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, rectSortingStrategy } from '@dnd-kit/sortable';
import { DropCtx } from './sortableHooks';
import { moveIdTo } from '@/lib/portfolioVersions';

/**
 * 작품 순서 — **끌어서 옮기기** (2026-10-15, 작가 요청 "작품 파일 등록 때 순서를 드래그로도 바꾸게").
 *
 * 홈페이지 편집 [작품] 의 격자와 PDF 만들기 [작품 고르기] 의 '실릴 순서' 줄이 같이 쓴다. 화살표(◀ ▶)는 그대로 둔다 —
 * 키보드로 쓰는 사람과, 한 칸만 옮길 때는 그게 더 정확하다.
 *
 * - **마우스는 늘 된다**(6px 움직이면 끌기 시작). 그냥 누르면 지금처럼 그 칸의 버튼(작품 정보 열기)이 눌린다.
 * - **손가락은 `touch` 일 때만**(사용자 결정) — 0.25초 길게 눌러야 시작한다. 평소 화면에서 켜 두면
 *   작품 격자를 손가락으로 훑어 내리다 순서가 바뀐다. 홈페이지 편집은 [순서 바꾸기] 를 눌렀을 때, PDF 의 '실릴 순서' 줄은 늘(그 줄이 순서 전용이다).
 * - ⚠️ 브라우저 기본 끌기(HTML5 drag)를 쓰지 말 것 — 휴대폰에서 아예 안 되고(관리자 할 일 보드가 그래서 화살표를 함께 둔다),
 *   작품 사진을 끌면 사진 파일 끌어다 놓기(올리기) 구역이 반응한다. dnd-kit 은 포인터·터치 이벤트로 움직인다.
 * - ⚠️ 놓은 직후의 클릭은 버린다(`useJustDropped`) — 마우스를 뗀 자리가 같은 칸이면 브라우저가 클릭을 보내 작품 정보 창이 열린다.
 * - 놓으면 **새 순서 전체**를 넘긴다(`onReorder`) — 서버도 전체 순서를 한 번에 받는다(`PUT /portfolio/images/order`).
 */

type Layout = 'grid' | 'row';

const instructions = '마우스로 끌어서 순서를 바꿀 수 있어요. 키보드로는 [순서 바꾸기] 를 누른 뒤 앞으로·뒤로 단추를 쓰세요.';
const announcements = (ids: number[], name: (id: number) => string): Announcements => ({
  onDragStart: ({ active }) => `${name(Number(active.id))} 을(를) 집었습니다.`,
  onDragOver: ({ active, over }) => (over ? `${name(Number(active.id))} — ${ids.indexOf(Number(over.id)) + 1}번째 자리` : undefined),
  onDragEnd: ({ active, over }) => (over ? `${name(Number(active.id))} 을(를) ${ids.indexOf(Number(over.id)) + 1}번째에 놓았습니다.` : `${name(Number(active.id))} 을(를) 제자리에 두었습니다.`),
  onDragCancel: ({ active }) => `${name(Number(active.id))} 옮기기를 취소했습니다.`,
});

export default function SortableArea({ ids, onReorder, layout, touch, overlay, itemName, children }: {
  ids: number[];
  /** 놓았을 때 — 새 순서 전체 */
  onReorder: (next: number[]) => void;
  layout: Layout;
  /** 손가락으로도 끌 수 있게(길게 눌러) — 끄면 마우스만 */
  touch: boolean;
  /** 끄는 동안 손가락·마우스를 따라오는 그림 */
  overlay: (id: number) => ReactNode;
  /** 화면 낭독용 이름 — "작품 3" 처럼 */
  itemName: (id: number) => string;
  children: ReactNode;
}) {
  const mouse = useSensor(MouseSensor, { activationConstraint: { distance: 6 } });
  const finger = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } });
  const sensors = useSensors(mouse, touch ? finger : null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const droppedAt = useRef(0);
  const justDropped = useCallback(() => Date.now() - droppedAt.current < 300, []);
  const a11y = useMemo(() => ({ announcements: announcements(ids, itemName), screenReaderInstructions: { draggable: instructions } }), [ids, itemName]);

  const onDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    if (!over || active.id === over.id) return;
    const next = moveIdTo(ids, Number(active.id), Number(over.id));
    if (next !== ids) onReorder(next);
  };

  return (
    <DropCtx.Provider value={justDropped}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setActiveId(null); droppedAt.current = Date.now(); }}
        accessibility={a11y}
      >
        <SortableContext items={ids} strategy={layout === 'grid' ? rectSortingStrategy : horizontalListSortingStrategy}>
          {children}
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
          {activeId != null ? <div className="h-full w-full cursor-grabbing">{overlay(activeId)}</div> : null}
        </DragOverlay>
      </DndContext>
    </DropCtx.Provider>
  );
}
