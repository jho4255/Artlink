/**
 * 홈페이지 이름 위 프로필 사진 (2026-10-28 사용자 요청 — "프로필사진도 넣을수있음 좋겠어. 선택할경우")
 * 규칙: Portfolio.showAvatar(기본 꺼짐) — 공개 홈페이지 응답에 그대로 싣고, 화면은 켜져 있고 사진이 있을 때만 그린다.
 *       PUT /portfolio 는 **보냈을 때만** 바꾼다(showPrice·designConfig 와 같은 방식 — 다른 화면의 저장이 켜 둔 걸 끄지 않게).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';

const ARTIST = 1;
const tok = () => authToken(ARTIST, 'ARTIST');
const mine = () => request.get('/api/portfolio').set('Authorization', `Bearer ${tok()}`);
const save = (body: Record<string, unknown>) =>
  request.put('/api/portfolio').set('Authorization', `Bearer ${tok()}`).send({ biography: '', career: null, ...body });
const publicPage = () => request.get(`/api/portfolio/${ARTIST}`);

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
  await mine();
});

describe('홈페이지 프로필 사진 보이기 — Portfolio.showAvatar', () => {
  it('★ 기본은 꺼짐 — 사진이 있어도 공개 응답은 showAvatar:false (카카오 프로필 사진이 저절로 뜨지 않는다)', async () => {
    await testPrisma.user.update({ where: { id: ARTIST }, data: { avatar: '/uploads/me.jpg' } });
    const r = await publicPage();
    expect(r.status).toBe(200);
    expect(r.body.showAvatar).toBe(false);
    expect(r.body.user.avatar).toBe('/uploads/me.jpg');
    expect((await mine()).body.showAvatar).toBe(false);
  });

  it('켜면 본인·공개 응답 둘 다 true · 끄면 false', async () => {
    expect((await save({ showAvatar: true })).body.showAvatar).toBe(true);
    expect((await publicPage()).body.showAvatar).toBe(true);
    expect((await mine()).body.showAvatar).toBe(true);
    expect((await save({ showAvatar: false })).body.showAvatar).toBe(false);
    expect((await publicPage()).body.showAvatar).toBe(false);
  });

  it('안 보내는 저장은 켜 둔 걸 끄지 않는다 · 형식이 틀리면 400(저장도 안 된다)', async () => {
    await save({ showAvatar: true });
    const r = await save({ tagline: '한 줄 소개만 고침' });
    expect(r.status).toBe(200);
    expect(r.body.showAvatar).toBe(true);
    for (const bad of ['yes', 1, null]) {
      const b = await save({ showAvatar: bad, tagline: '바뀌면 안 됨' });
      expect(b.status, String(bad)).toBe(400);
    }
    const after = await mine();
    expect(after.body.showAvatar).toBe(true);
    expect(after.body.tagline).toBe('한 줄 소개만 고침');
  });

  it('포트폴리오를 아직 안 만든 작가의 공개 응답도 false', async () => {
    await testPrisma.portfolio.deleteMany({ where: { userId: ARTIST } });
    const r = await publicPage();
    expect(r.status).toBe(200);
    expect(r.body.showAvatar).toBe(false);
  });
});
