/** 관리자 화면의 짧은 날짜·시간 말(2026-11-21) — 표 칸에 들어가게 짧게. 날짜는 KST */

/** 시간 → '5시간' · '2일' · '40분' */
export function hoursText(h: number | null | undefined): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h)}시간`;
  return `${Math.round(h / 24)}일`;
}

/** 이 순간이 얼마나 지났나 — '3시간 전' · '어제' · '2일째' 대신 쓰는 짧은 말 */
export function agoText(iso: string | Date | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const min = Math.max(0, (now.getTime() - t) / 60000);
  if (min < 60) return `${Math.max(1, Math.round(min))}분 전`;
  if (min < 24 * 60) return `${Math.round(min / 60)}시간 전`;
  const days = Math.floor(min / (24 * 60));
  return days === 1 ? '어제' : `${days}일 전`;
}

/** 'M.D' · 올해가 아니면 'YYYY.M.D' */
export function shortDate(iso: string | Date | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);   // KST
  const y = d.getUTCFullYear();
  const md = `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  return y === new Date(now.getTime() + 9 * 3600000).getUTCFullYear() ? md : `${y}.${md}`;
}

/** '오늘 15:02' · '어제' · 'M.D' */
export function seenText(iso: string | Date | null | undefined, now: Date = new Date()): string {
  if (!iso) return '기록 없음';
  const k = (x: Date) => { const d = new Date(x.getTime() + 9 * 3600000); return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; };
  const t = new Date(iso);
  if (k(t) === k(now)) {
    const d = new Date(t.getTime() + 9 * 3600000);
    return `오늘 ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  if (k(t) === k(new Date(now.getTime() - 86400000))) return '어제';
  return shortDate(t, now);
}

/** 이 순간부터 지금까지 꼬박 며칠 — '2일째 기다리는 중' */
export function daysWaited(iso: string | Date | null | undefined, now: Date = new Date()): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
}

/** 앞 기간과 견주기 — '▲ 23% · 앞선 30일 198' */
export function deltaText(current: number | null | undefined, previous: number | null | undefined, days: number, unit = ''): string {
  if (current == null) return '';
  if (previous == null) return `앞선 ${days}일 기록 없음`;
  const prev = `앞선 ${days}일 ${fmtNum(previous)}${unit}`;
  if (previous === 0) return current === 0 ? `변화 없음 · ${prev}` : `새로 · ${prev}`;
  const pctChange = Math.round(((current - previous) / previous) * 100);
  if (pctChange === 0) return `변화 없음 · ${prev}`;
  return `${pctChange > 0 ? '▲' : '▼'} ${Math.abs(pctChange)}% · ${prev}`;
}

export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtPct(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${Math.round(r * 100)}%`;
}

export function won(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 100_000_000) return `${(n / 100_000_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만 원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

