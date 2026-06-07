/**
 * JWT 시크릿 단일 소스. production에서 미설정 시 부팅 실패(fail-closed)로 토큰 위조 위험 차단.
 * Render는 새 인스턴스가 헬스체크를 통과해야 트래픽을 전환하므로, 미설정 시 배포만 실패하고 기존 버전은 유지됨.
 */
const fromEnv = process.env.JWT_SECRET;
if (!fromEnv && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다. (production 필수)');
}
export const JWT_SECRET: string = fromEnv || 'artlink-dev-secret';
