/**
 * 앱 전역 설정 (AppSetting key-value) 헬퍼
 *
 * Admin 개발자 도구 토글 등 런타임 플래그를 DB에 영속화한다.
 * - allowAcceptedRevert: ON이면 전체 갤러리가 '수락'한 지원을 '거절'로 되돌릴 수 있음 (임시 개발자 도구)
 */
import prisma from './prisma';

export const ALLOW_ACCEPTED_REVERT = 'allowAcceptedRevert';

export async function getSettingBool(key: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value === 'true';
}

export async function setSettingBool(key: string, value: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}
