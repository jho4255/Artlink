/**
 * @mention 파싱 및 검증
 * 텍스트에서 @닉네임 패턴을 찾아 사용자를 태그한다.
 *
 * 포맷: @닉네임 (닉네임이 없으면 이름 사용)
 * 예: "@작가이름" → User.nickname 또는 User.name
 */

/** 텍스트에서 @mention 추출. @닉네임(2~20자) 패턴 */
export function extractMentions(text: string): string[] {
  const matches = text.match(/@([가-힣a-zA-Z0-9_-]{2,20})/g);
  if (!matches) return [];
  // 중복 제거
  return [...new Set(matches.map((m) => m.slice(1)))]; // @제거
}

/** 텍스트에서 멘션된 사용자의 id 가져오기 (닉네임 또는 이름으로 검색) */
export async function resolveMentions(
  mentions: string[],
  prisma: any
): Promise<{ [key: string]: number | null }> {
  const resolved: { [key: string]: number | null } = {};
  for (const m of mentions) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ nickname: m }, { name: m }],
      },
      select: { id: true },
    });
    resolved[m] = user?.id ?? null;
  }
  return resolved;
}

/** 텍스트에서 유효한 @mention만 남기고 재구성 */
export async function normalizeMentions(
  text: string,
  prisma: any
): Promise<string> {
  const mentions = extractMentions(text);
  if (mentions.length === 0) return text;

  const resolved = await resolveMentions(mentions, prisma);
  let result = text;

  // 유효하지 않은 @mention 제거
  for (const [mention, id] of Object.entries(resolved)) {
    if (id === null) {
      result = result.replace(new RegExp(`@${mention}\\b`, 'g'), mention);
    }
  }

  return result;
}
