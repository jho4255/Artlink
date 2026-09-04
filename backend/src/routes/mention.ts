/**
 * 멘션 자동완성 — "지금 내가 부를 수 있는 사람" 목록.
 *
 * ⚠️ **아무나 검색하는 사용자 검색 API 가 아니다.** 대화(ArtTalk)와 같은 설계 원칙이다 —
 *    임의 검색으로 아무에게나 말을 걸 수 없고, **이미 맺어진 관계**(서로 이웃)와
 *    **공개 창구**(ArtLink=운영)만 부를 수 있다. 그래서 이름 그대로 `/mentions` 다.
 *    `/users/search` 같은 이름으로 되돌리지 말 것 — 그 순간 전체 회원 검색으로 오해돼
 *    다른 화면에서 갖다 쓰고, 곧 아무나 태그할 수 있게 된다.
 *
 * 판정은 전부 `lib/mention.ts` 가 한다(저장 시 검증과 **같은 함수**).
 */
import { Router } from 'express';
import prisma from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import { mentionTargets, filterTargets } from '../lib/mention';

const router = Router();

// GET /api/mentions?q= — 부를 수 있는 사람(ArtLink + 서로 이웃) 중 검색어와 맞는 사람
router.get('/', authenticate, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const targets = await mentionTargets(prisma, req.user!.id);
    res.json(
      filterTargets(targets, q).map((t) => ({
        label: t.label,   // `@` 뒤에 넣을 글자
        id: t.id,         // ArtLink 는 브랜드라 null
        avatar: t.avatar,
        role: t.role,
      })),
    );
  } catch (e) { next(e); }
});

export default router;
