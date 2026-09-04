/**
 * @멘션 — **누구를 부를 수 있는가**가 이 파일의 전부다.
 *
 * 규칙은 둘뿐이다.
 *   1. **ArtLink** — 운영(Admin)을 부르는 브랜드 핸들. **누구나** 부를 수 있다(문의·신고 창구).
 *   2. 그 밖에는 **서로 이웃**(양방향 팔로우)만. 한쪽만 팔로우한 사이는 못 부른다.
 *
 * ⚠️ **자동완성과 저장 검증이 반드시 같은 함수를 써야 한다.** 목록에 띄워 놓고 저장할 때
 *    막으면 함정이고, 반대로 목록에 없는 사람을 저장이 통과시키면 규칙이 조용히 무너진다.
 *    그래서 `mentionTargets()` 하나가 두 곳(`routes/mention.ts` 검색, `resolveMentions` 저장)의
 *    유일한 출처다.
 *
 * ⚠️ **정규식으로 핸들을 잘라내지 말 것.** 예전 구현이 `@([가-힣a-zA-Z0-9_-]{2,20})` 였는데
 *    두 가지가 깨졌다 — ①이름에 공백이 있으면(시드 계정 'Artist 1', 갤러리 상호 대부분)
 *    앞 토막만 잘려 영영 안 맞는다 ②프론트의 `\w` 는 아예 한글을 모른다(한국어 서비스인데).
 *    지금은 **부를 수 있는 사람 목록에서 가장 긴 이름을 앞에서부터 맞춰 본다**(`matchAt`).
 *    후보가 수십 명 수준이라 싸고, 공백·한글·대소문자를 전부 자연스럽게 먹는다.
 *    무엇보다 **목록에 없는 사람은 애초에 매칭되지 않아** 권한이 구조로 보장된다.
 *
 * ⚠️ **사용자가 쓴 글자를 고쳐 저장하지 말 것.** 예전엔 못 찾은 멘션의 `@` 를 떼어 저장했다 —
 *    이메일이나 '@내일' 같은 평범한 글이 조용히 바뀌었고, 무엇보다 자기가 쓴 것과 다른 글이
 *    올라간다. 지금은 **글은 그대로 두고** 부를 수 있는 사람에게만 알림을 보낸다.
 */

/** 운영(Admin)을 부르는 브랜드 핸들. 누구나 쓸 수 있다. */
export const ARTLINK_HANDLE = 'ArtLink';

export interface MentionTarget {
  /** 알림을 받을 사용자 id 들. ArtLink 는 운영자가 여럿일 수 있어 배열이다. */
  userIds: number[];
  /** `@` 뒤에 들어가는 글자. 화면 표시도 이것. */
  label: string;
  /** 목록에 얼굴을 띄우기 위한 것 — ArtLink 는 브랜드라 없다. */
  id: number | null;
  avatar: string | null;
  role: string;
}

const displayName = (u: { name: string; nickname: string | null }) => u.nickname || u.name;

/** 서로 이웃(양방향 팔로우) id — `routes/follow.ts` 의 `/mutuals` 와 같은 규칙. */
export async function mutualIds(prisma: any, meId: number): Promise<number[]> {
  const [iFollow, followMe] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: meId }, select: { followingId: true } }),
    prisma.follow.findMany({ where: { followingId: meId }, select: { followerId: true } }),
  ]);
  const followMeSet = new Set(followMe.map((f: any) => f.followerId));
  return iFollow.map((f: any) => f.followingId).filter((id: number) => followMeSet.has(id));
}

/**
 * 내가 부를 수 있는 사람 전부 — **ArtLink + 서로 이웃**.
 * 자동완성과 저장 검증이 함께 쓰는 단일 출처다.
 */
export async function mentionTargets(prisma: any, meId: number): Promise<MentionTarget[]> {
  const [me, admins] = await Promise.all([
    prisma.user.findUnique({ where: { id: meId }, select: { role: true } }),
    prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: { id: true } }),
  ]);

  const out: MentionTarget[] = [];

  // ArtLink 는 사람이 아니라 창구다 — 운영자 전원에게 알림이 간다.
  if (admins.length > 0) {
    out.push({
      userIds: admins.map((a: any) => a.id),
      label: ARTLINK_HANDLE,
      id: null,
      avatar: null,
      role: 'ADMIN',
    });
  }

  // ⚠️ **운영(Admin)은 모두와 서로 이웃으로 친다** — 공지·중재를 하려면 아무나 부를 수 있어야 한다.
  //    다만 `Follow` 행을 만들지도, 화면에 '이웃'이라고 **표기하지도 않는다** —
  //    실제로 맺은 관계가 아니고, 팔로워 수·이웃 목록이 부풀면 그게 곧 거짓말이 된다.
  //    여기(부를 수 있는 사람 판정)에서만 예외로 둔다.
  const canCallEveryone = me?.role === 'ADMIN';
  const reachable = canCallEveryone ? null : await mutualIds(prisma, meId);

  if (canCallEveryone || (reachable && reachable.length > 0)) {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        id: reachable ? { in: reachable } : { not: meId },
        ...(canCallEveryone ? { role: { not: 'ADMIN' } } : {}),   // 운영끼리는 ArtLink 로 통한다
      },
      select: { id: true, name: true, nickname: true, avatar: true, role: true },
      orderBy: { name: 'asc' },
      // ⚠️ Admin 경로에 **`take` 를 걸지 말 것.** 저장할 때 이 목록에서 이름을 되찾으므로(최장일치),
      //    잘라내면 목록 밖 사람은 **에러 없이 조용히** 멘션이 안 먹는다(자동완성엔 떴는데도).
      //    지금 회원 수가 수백이라 id·이름만 받으면 부담이 없다. 수천 명이 되면 그때
      //    ①검색은 DB `contains` 로 ②저장은 글에서 뽑은 토큰만 조회하는 방식으로 나눌 것.
    });
    for (const u of users) {
      out.push({ userIds: [u.id], label: displayName(u), id: u.id, avatar: u.avatar, role: u.role });
    }
  }

  // 긴 이름을 먼저 맞춰 봐야 '@Art' 가 '@ArtLink' 를 가로채지 않는다.
  return out.sort((a, b) => b.label.length - a.label.length);
}

/** 자동완성용 — 부를 수 있는 사람 중 검색어로 거른다. 빈 검색어면 전부(짧은 목록이다). */
export function filterTargets(targets: MentionTarget[], q: string, limit = 8): MentionTarget[] {
  const needle = q.trim().toLowerCase();
  const hit = needle
    ? targets.filter((t) => t.label.toLowerCase().includes(needle))
    : targets;
  // 검색어로 **시작하는** 사람을 앞에 (인스타·트위터와 같은 감각)
  return [...hit]
    .sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(needle) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(needle) ? 0 : 1;
      return as - bs || a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

/**
 * `@` 하나가 어떤 대상을 가리키는지 — **가장 긴 이름이 이긴다**.
 * `targets` 는 길이 내림차순으로 정렬돼 있어야 한다(`mentionTargets` 가 그렇게 준다).
 */
function matchAt(text: string, at: number, targets: MentionTarget[]): MentionTarget | null {
  const rest = text.slice(at + 1).toLowerCase();
  for (const t of targets) {
    if (rest.startsWith(t.label.toLowerCase())) return t;
  }
  return null;
}

/**
 * 글에서 **부를 수 있는** 멘션만 찾아낸다. 못 부르는 사람 이름은 그냥 글자로 남는다
 * (막았다고 글을 고치지 않는다 — 위 주석 참고).
 *
 * 같은 사람을 여러 번 불러도 한 번만 돌려준다(알림 중복 방지).
 */
export async function resolveMentions(
  prisma: any,
  meId: number,
  text: string,
): Promise<MentionTarget[]> {
  if (!text || !text.includes('@')) return [];
  const targets = await mentionTargets(prisma, meId);
  if (targets.length === 0) return [];

  const found = new Map<string, MentionTarget>();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '@') continue;
    const hit = matchAt(text, i, targets);
    if (hit) found.set(hit.label, hit);
  }
  return [...found.values()];
}

/**
 * 멘션된 사람에게 알림. **본인은 뺀다**(자기를 부르고 알림 받을 이유가 없다).
 *
 * best-effort 다 — 알림이 실패해도 글 작성은 성공해야 한다.
 * `refKey` 로 같은 글의 같은 사람에겐 한 건만 남긴다(`@나 @나` 를 두 번 세지 않게).
 */
export async function notifyMentions(
  prisma: any,
  opts: {
    meId: number; meName: string; targets: MentionTarget[];
    where: string; linkUrl: string; refKey: string;
    /** 이미 다른 알림을 받은 사람(예: 댓글이 달린 글의 주인) — 한 번에 두 통은 잔소리다. */
    skip?: number[];
  },
): Promise<void> {
  const { meId, meName, targets, where, linkUrl, refKey, skip = [] } = opts;
  const skipSet = new Set([meId, ...skip]);
  const userIds = [...new Set(targets.flatMap((t) => t.userIds))].filter((id) => !skipSet.has(id));
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: 'MENTION',
        message: `${meName}님이 ${where}에서 회원님을 언급했습니다.`,
        linkUrl,
        refKey,
      })),
      skipDuplicates: true,
    });
  } catch { /* best-effort — 알림 실패로 글이 안 올라가면 안 된다 */ }
}
