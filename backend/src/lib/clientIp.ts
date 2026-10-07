import type { Request } from 'express';

/**
 * 요청한 사람의 접속 주소 — Cloudflare 가 붙여 주는 `CF-Connecting-IP` 를 먼저 본다(2026-10-08).
 * artlink.cc 는 Cloudflare → Render(이것도 Cloudflare 엣지)를 거쳐 들어와 `req.ip`(trust proxy 1)가 엣지 주소일 수 있다.
 * Cloudflare 는 이 헤더를 직접 채우고 클라이언트가 보낸 값을 덮어쓴다(Render 서비스에는 Cloudflare 를 거치지 않고 닿는 길이 없다).
 * 없으면(로컬) `req.ip`. 쓰는 곳: index.ts 의 로그인·가입 한도 · lib/loginThrottle.ts(이메일+주소별 로그인 실패).
 */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return String((Array.isArray(cf) ? cf[0] : cf) || req.ip || '');
}
