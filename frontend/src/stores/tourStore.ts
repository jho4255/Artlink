import { create } from 'zustand';
import { type TourStep, markTourSeen } from '@/lib/tours';

/**
 * 온보딩 투어 런타임 상태 (한 번에 하나의 투어만 활성)
 *  - start(tourId, steps): 투어 시작
 *  - next/prev: 스텝 이동 (마지막에서 next → 종료 + '봤음' 저장)
 *  - stop: 즉시 종료(건너뛰기 포함). 완료로 간주해 다시 뜨지 않게 저장.
 */
interface TourState {
  tourId: string | null;
  steps: TourStep[];
  index: number;
  start: (tourId: string, steps: TourStep[]) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  tourId: null,
  steps: [],
  index: 0,
  start: (tourId, steps) => set({ tourId, steps, index: 0 }),
  next: () => {
    const { index, steps, tourId } = get();
    if (index >= steps.length - 1) {
      if (tourId) markTourSeen(tourId);
      set({ tourId: null, steps: [], index: 0 });
    } else {
      set({ index: index + 1 });
    }
  },
  prev: () => set((s) => ({ index: Math.max(0, s.index - 1) })),
  stop: () => {
    const { tourId } = get();
    if (tourId) markTourSeen(tourId);
    set({ tourId: null, steps: [], index: 0 });
  },
}));
