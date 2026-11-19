/**
 * 카카오 API 를 부르는 곳은 여기 하나다 (2026-11-19, CLAUDE.md 규칙 86).
 *
 * 왜: 실서버(Render 싱가포르, 나가는 IP 74.220.52.222)에서 kauth.kakao.com·kapi.kakao.com 으로의 TCP 연결이 통째로 막힌 일이 있었다.
 *     카카오 장애가 아니었다 — 한국·싱가포르의 다른 망·해외 40곳에서는 다 닿았고 그 IP 에서만 안 닿았다. 그동안 카카오 로그인·가입이 전부 멈췄다.
 *     그래서 **코드 배포 없이 Render 환경 변수만 바꿔** Cloudflare 중계(infra/cloudflare/kakao-relay.js)를 거치게 한다.
 *
 *   KAKAO_AUTH_URL      기본 https://kauth.kakao.com  — 중계를 쓰면 https://<Worker 주소>/auth
 *   KAKAO_API_URL       기본 https://kapi.kakao.com   — 중계를 쓰면 https://<Worker 주소>/api
 *   KAKAO_RELAY_SECRET  중계 Worker 의 RELAY_SECRET 과 같은 값 — 중계로 갈 때만 X-Relay-Secret 머리로 보낸다
 *
 * ⚠️ 중계 주소는 https 만 받는다 — 인가 코드·접근 토큰이 지나간다. http 로 적으면 무시하고 카카오로 바로 간다(로그에 남긴다).
 * ⚠️ 비밀 값은 중계로 갈 때만 보낸다 — 카카오로 바로 갈 때 실어 보내면 남의 서버에 우리 비밀이 쌓인다.
 * ⚠️ 카카오에 못 닿으면 기다리다 '서버 내부 오류' 500 을 주지 않는다 — 8초 뒤 503 + 원인(err.cause)을 로그에.
 *    예전엔 undici 기본 연결 대기(10초) 뒤 "fetch failed" 한 줄만 남아 원인을 알 수 없었다.
 */
import { AppError } from '../middleware/errorHandler';

export type KakaoHost = 'auth' | 'api';

const OFFICIAL: Record<KakaoHost, string> = {
  auth: 'https://kauth.kakao.com',
  api: 'https://kapi.kakao.com',
};
const ENV_KEY: Record<KakaoHost, 'KAKAO_AUTH_URL' | 'KAKAO_API_URL'> = {
  auth: 'KAKAO_AUTH_URL',
  api: 'KAKAO_API_URL',
};

export const KAKAO_TIMEOUT_MS = 8000;
export const KAKAO_UNREACHABLE = '카카오에 연결하지 못했어요. 잠시 후 다시 시도하거나 이메일로 로그인해 주세요.';

const warned = new Set<string>();

/** 그 호스트의 기본 주소(끝 / 없음) — 환경 변수가 https 가 아니면 공식 주소 */
export function kakaoBase(kind: KakaoHost): string {
  const raw = (process.env[ENV_KEY[kind]] || '').trim();
  if (!raw) return OFFICIAL[kind];
  if (!/^https:\/\/[^/\s]+/i.test(raw)) {
    if (!warned.has(raw)) {
      warned.add(raw);
      console.error(`[Kakao] ${ENV_KEY[kind]} 는 https 주소여야 합니다 — 무시하고 카카오로 바로 보냅니다`);
    }
    return OFFICIAL[kind];
  }
  return raw.replace(/\/+$/, '');
}

/** 중계를 거치는가(공식 주소가 아닌가) */
export function kakaoRelayed(kind: KakaoHost): boolean {
  return kakaoBase(kind) !== OFFICIAL[kind];
}

/**
 * 카카오(또는 중계)에 요청한다. 연결 실패·시간 초과는 503 AppError 로 바꾼다.
 * 응답(4xx·5xx 포함)은 그대로 돌려준다 — 카카오의 오류 바디를 읽는 건 부르는 쪽 일이다.
 */
export async function kakaoFetch(kind: KakaoHost, path: string, init: RequestInit = {}): Promise<Response> {
  const relayed = kakaoRelayed(kind);
  const url = kakaoBase(kind) + path;
  const headers = new Headers(init.headers);
  const secret = (process.env.KAKAO_RELAY_SECRET || '').trim();
  if (relayed && secret) headers.set('X-Relay-Secret', secret);
  try {
    return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS) });
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    console.error('[Kakao Unreachable]', {
      host: kind, relayed, path,
      error: e?.name || 'Error', message: e?.message,
      cause: e?.cause?.code || e?.cause?.message,
    });
    throw new AppError(KAKAO_UNREACHABLE, 503);
  }
}
