/**
 * 사용자 제공 파일 URL 정규화 — 저장형 XSS(javascript:/data: 등) 방지.
 * 동일 출처 상대경로(/uploads/..)와 http(s)만 허용. 그 외 스킴은 null로 폐기.
 */
export function safeFileUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  const t = u.trim();
  if (!t) return null;
  if (t.startsWith('/')) return t; // 동일 출처 업로드 경로
  try {
    const p = new URL(t);
    return p.protocol === 'http:' || p.protocol === 'https:' ? t : null;
  } catch {
    return null;
  }
}
