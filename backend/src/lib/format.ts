/**
 * 금액 포맷 유틸 (서버)
 */

/**
 * 가격 → 만원 단위 한국식 표기.
 *  예) 230000 → "23만원", 235000 → "23만 5,000원", 1230000 → "123만원", 100000000 → "1억원"
 * 숫자가 없으면(비매/협의 등) 원문 그대로 반환. — 캡션 표기용.
 */
export function toManWon(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return s;
  const n = parseInt(digits, 10);
  if (!n) return s;
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  const won = n % 1e4;
  const parts: string[] = [];
  if (eok) parts.push(`${eok.toLocaleString('ko')}억`);
  if (man) parts.push(`${man.toLocaleString('ko')}만`);
  if (won) parts.push(`${won.toLocaleString('ko')}원`);
  else if (parts.length) parts[parts.length - 1] += '원';
  return parts.join(' ');
}
