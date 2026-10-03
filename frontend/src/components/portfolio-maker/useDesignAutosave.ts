import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/axios';
import { keepWebOnlyKeys } from '@/lib/homepageTheme';
import type { PdfDesign } from '@/lib/portfolioFormats';
import type { Portfolio } from '@/types';
import type { DesignSaveState } from './MakerBar';

const errText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

interface SaveJob { design: PdfDesign; versionId: number | null }

/**
 * 디자인 자동 저장 — 마지막 값만 0.8초 뒤에 보내고, 떠날 때 남은 것이 있으면 바로 보낸다.
 * 요청은 **줄을 세워** 보낸다 — 응답 순서가 뒤집혀 나중 선택이 사라지는 일이 없게.
 *
 * `onGone(versionId)` — 그 구성이 **다른 곳에서 지워졌다**(PATCH 가 404). 오류로 남기면 [다시 시도] 를 눌러도 영원히 404 라
 * 화면이 '저장 못 함' 에 갇힌다(2026-10-03 신뢰성 검사 R10). 부모가 전체 작품으로 돌아간다. 이때는 토스트도 띄우지 않는다.
 */
export function useDesignAutosave(onGone?: (versionId: number) => void) {
  const queryClient = useQueryClient();
  const goneRef = useRef(onGone);
  useEffect(() => { goneRef.current = onGone; });
  const [state, setState] = useState<DesignSaveState>('idle');
  const timer = useRef<number | null>(null);
  const pending = useRef<SaveJob | null>(null);
  const last = useRef<SaveJob | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const send = useCallback(async (job: SaveJob) => {
    last.current = job;
    setState('saving');
    try {
      if (job.versionId != null) {
        await api.patch(`/portfolio/versions/${job.versionId}`, { design: job.design });
        queryClient.setQueryData<Portfolio>(['portfolio'], (old) => (old
          ? { ...old, versions: (old.versions ?? []).map((v) => (v.id === job.versionId ? { ...v, design: job.design } : v)) }
          : old));
      } else {
        // 서버는 designConfig 를 통째로 갈아끼운다 — 홈페이지에서 고른 대표작·웹 테마 표식을 **지금 캐시에서** 옮겨 싣는다(규칙 49)
        const saved = queryClient.getQueryData<Portfolio>(['portfolio'])?.designConfig;
        const designConfig = keepWebOnlyKeys(job.design, saved);
        await api.put('/portfolio/design', { designConfig });
        queryClient.setQueryData<Portfolio>(['portfolio'], (old) => (old ? { ...old, designConfig } : old));
      }
      setState('saved');
      // 공개 홈페이지 캐시(`['portfolio', id]`)도 함께 — 웹 테마를 고른 작가는 색·글꼴이 홈페이지와 한 벌이다
      queryClient.invalidateQueries({ queryKey: ['portfolio'], predicate: (q) => q.queryKey.length > 1 });
    } catch (err) {
      if (job.versionId != null && (err as { response?: { status?: number } })?.response?.status === 404) {
        last.current = null;   // [다시 시도] 가 지워진 구성으로 또 보내지 않게
        setState('idle');
        goneRef.current?.(job.versionId);
        return;
      }
      setState('error');
      toast.error(errText(err, '디자인을 저장하지 못했습니다.'));
    }
  }, [queryClient]);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const job = pending.current;
    pending.current = null;
    if (job) chain.current = chain.current.then(() => send(job));
    return chain.current;
  }, [send]);

  const schedule = useCallback((design: PdfDesign, versionId: number | null) => {
    // 다른 구성의 변경이 아직 안 갔으면 그것부터 보낸다(이 구성의 값이 덮어쓰면 그쪽 변경이 사라진다)
    if (pending.current && pending.current.versionId !== versionId) void flush();
    pending.current = { design, versionId };
    setState('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void flush(); }, 800);
  }, [flush]);

  const retry = useCallback(() => {
    const job = pending.current ?? last.current;
    pending.current = null;
    if (job) chain.current = chain.current.then(() => send(job));
  }, [send]);

  useEffect(() => () => { void flush(); }, [flush]);
  return { state, schedule, flush, retry };
}
