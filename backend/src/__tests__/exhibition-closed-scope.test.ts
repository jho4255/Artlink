/**
 * 공개 모집공고 목록 — 마감된 공고 탭 (`GET /api/exhibitions?scope=closed`)
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────
 * 마감되면 목록에서 통째로 사라져 화면이 비었다(실측: 노출 4건 / 숨김 6건).
 * 지원자 19명이 붙었던 공모도 흔적이 없어 갤러리가 뭘 해왔는지 알 수 없었다.
 *
 * ── 여기서 반드시 지켜야 하는 것 ────────────────────────────
 * ⚠️ **미승인 공모가 마감 탭으로 새면 안 된다.** 심사중(PENDING)·반려(REJECTED)·
 *    탈퇴(WITHDRAWN)가 노출되면 남의 미승인 공모를 공개하는 셈이다.
 *    예전에 상세 라우트에서 같은 사고가 있었다(CLAUDE.md 23) — 목록도 화이트리스트로 막는다.
 * ⚠️ 목록에 뜨는 것과 **지원할 수 있는 것은 별개다.** 지원 차단은 `POST /:id/apply` 가
 *    상태·수동마감·전시종료·마감일 4중으로 한다. 목록 노출이 지원 경로를 열지 않는다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery } from './helpers';

const artistTok = authToken(1, 'ARTIST');

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

describe('공개 모집공고 — 마감된 공고 노출', () => {
  let galleryId: number;

  const makeEx = (title: string, extra: Record<string, unknown> = {}) =>
    testPrisma.exhibition.create({
      data: {
        title, type: 'GROUP', region: 'SEOUL', capacity: 5, description: '설명',
        deadline: daysFromNow(7), exhibitDate: daysFromNow(30),
        status: 'APPROVED', galleryId,
        ...extra,
      },
    });

  const titles = async (scope?: string) => {
    const res = await request.get(`/api/exhibitions${scope ? `?scope=${scope}` : ''}`);
    expect(res.status).toBe(200);
    return res.body.map((e: any) => e.title);
  };

  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    galleryId = (await seedGallery(3)).id;
  });

  it('기본(scope 없음)은 모집 중만 — 마감분은 안 보인다', async () => {
    await makeEx('모집중');
    await makeEx('마감일지남', { deadline: daysFromNow(-3) });
    await makeEx('수동마감', { recruitmentClosed: true });

    expect(await titles()).toEqual(['모집중']);
    expect(await titles('open')).toEqual(['모집중']);
  });

  it('scope=closed 는 마감분만 — 마감일 지남 / 수동 모집마감 / 전시종료', async () => {
    await makeEx('모집중');
    await makeEx('마감일지남', { deadline: daysFromNow(-3) });
    await makeEx('수동마감', { recruitmentClosed: true });
    await makeEx('전시종료', { ended: true });

    const closed = await titles('closed');
    expect(closed).toContain('마감일지남');
    expect(closed).toContain('수동마감');
    expect(closed).toContain('전시종료');
    expect(closed).not.toContain('모집중');
  });

  it('마감 탭은 최근에 끝난 순', async () => {
    await makeEx('오래전', { deadline: daysFromNow(-90) });
    await makeEx('최근', { deadline: daysFromNow(-2) });
    await makeEx('중간', { deadline: daysFromNow(-30) });

    expect(await titles('closed')).toEqual(['최근', '중간', '오래전']);
  });

  /** 이 테스트가 이 파일의 존재 이유다 */
  it('미승인 공모는 마감 탭으로도 절대 새지 않는다', async () => {
    await makeEx('심사중', { status: 'PENDING', deadline: daysFromNow(-3) });
    await makeEx('반려', { status: 'REJECTED', recruitmentClosed: true });
    await makeEx('탈퇴', { status: 'WITHDRAWN', ended: true });
    await makeEx('정상마감', { deadline: daysFromNow(-3) });

    const closed = await titles('closed');
    expect(closed).toEqual(['정상마감']);
    expect(await titles('open')).toEqual([]);
  });

  it('알 수 없는 scope 값은 모집 중으로 취급 (기본이 숨김이어야 한다)', async () => {
    await makeEx('모집중');
    await makeEx('마감', { deadline: daysFromNow(-3) });

    for (const bad of ['CLOSED', 'all', '1', 'closed ']) {
      expect(await titles(encodeURIComponent(bad))).toEqual(['모집중']);
    }
  });

  it('검색어와 함께 써도 마감 조건이 유지된다 (OR 이 덮어써지면 안 된다)', async () => {
    await makeEx('푸른 밤 공모');                                   // 모집중
    await makeEx('푸른 낮 공모', { deadline: daysFromNow(-3) });     // 마감
    await makeEx('붉은 밤 공모', { deadline: daysFromNow(-3) });     // 마감

    const res = await request.get('/api/exhibitions?scope=closed&q=푸른');
    expect(res.body.map((e: any) => e.title)).toEqual(['푸른 낮 공모']);
  });

  it('지역 필터도 마감 탭에서 동작한다', async () => {
    await makeEx('서울마감', { deadline: daysFromNow(-3), region: 'SEOUL' });
    await makeEx('부산마감', { deadline: daysFromNow(-3), region: 'BUSAN' });

    const res = await request.get('/api/exhibitions?scope=closed&region=BUSAN');
    expect(res.body.map((e: any) => e.title)).toEqual(['부산마감']);
  });

  /** 목록에 보이는 것과 지원할 수 있는 것은 별개 — 서버가 막는다 */
  describe('마감 공고에는 지원할 수 없다', () => {
    it('마감일이 지나면 400', async () => {
      const ex = await makeEx('마감일지남', { deadline: daysFromNow(-3) });
      const res = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${artistTok}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('마감');
    });

    it('수동 모집마감이면 400', async () => {
      const ex = await makeEx('수동마감', { recruitmentClosed: true });
      const res = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${artistTok}`).send({});
      expect(res.status).toBe(400);
    });

    it('전시종료면 400', async () => {
      const ex = await makeEx('전시종료', { ended: true });
      const res = await request.post(`/api/exhibitions/${ex.id}/apply`).set('Authorization', `Bearer ${artistTok}`).send({});
      expect(res.status).toBe(400);
    });

    it('마감된 공고 상세는 열린다 (기록 열람은 되어야 한다)', async () => {
      const ex = await makeEx('마감', { deadline: daysFromNow(-3) });
      const res = await request.get(`/api/exhibitions/${ex.id}`);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('마감');
    });
  });
});
