/**
 * 포트폴리오 만들기 화면이 쓰는 서버 경로 (2026-10-03)
 *   `PUT  /api/portfolio/design`  디자인만 저장
 *   `PUT  /api/portfolio/file`    만든 PDF 를 홈페이지 [포트폴리오] 탭에 올리기
 *   `POST /api/portfolio/exports` 저장 기록
 *   `GET  /api/admin/stats/portfolio-exports` 날짜별 저장 통계
 *
 * 지켜야 하는 것:
 *  ① 디자인 저장은 **디자인만** 바꾼다 — 약력·작가노트·파일을 건드리지 않는다
 *     (예전엔 색 하나를 바꿀 때마다 화면이 들고 있던 옛 글을 통째로 다시 보내, 다른 탭에서 고친 글이 되돌아갔다)
 *  ② 깨진 디자인 값을 조용히 null(초기화)로 저장하지 않는다
 *  ③ 파일은 **우리 저장소 주소만** — 공개 홈페이지에 그대로 걸리는 주소다
 *  ④ ★ 파일을 바꿔도 **지원서가 가리키는 옛 파일은 지우지 않는다**(지원서는 지원할 때 주소를 복사해 든다)
 *  ⑤ 저장 기록은 작가만, 날짜는 서버가 KST 로. 형식이 틀리면 400, 하루 한도를 넘으면 조용히 버린다
 *  ⑥ 통계는 Admin 만 — 기록 없는 날은 0, 방식별·작가 수(사람 단위)
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { dailyExportStats, recordExport, EXPORT_DAILY_CAP } from '../lib/exportStats';
import { dayKey, kstDay } from '../lib/visitStats';

const artist = `Bearer ${authToken(1, 'ARTIST')}`;
const artist2 = `Bearer ${authToken(2, 'ARTIST')}`;
const gallery = `Bearer ${authToken(3, 'GALLERY')}`;
const admin = `Bearer ${authToken(4, 'ADMIN')}`;

const UPLOADS = path.join(__dirname, '../../uploads');
const touch = (tag: string) => {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const name = `pfx-${tag}-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
  fs.writeFileSync(path.join(UPLOADS, name), '%PDF-1.4 test');
  return { name, url: `/uploads/${name}`, exists: () => fs.existsSync(path.join(UPLOADS, name)), remove: () => { try { fs.unlinkSync(path.join(UPLOADS, name)); } catch { /* 이미 없음 */ } } };
};
/** 서버가 응답 뒤에 지우므로(`void`) 잠깐 기다린다 */
const settle = async (gone: () => boolean) => { for (let i = 0; i < 20 && !gone(); i++) await new Promise((r) => setTimeout(r, 25)); };
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('포트폴리오 디자인만 저장 — PUT /api/portfolio/design', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    await testPrisma.portfolio.create({
      data: {
        userId: 1, biography: '원래 약력', statement: '원래 작가노트', tagline: '한 줄', portfolioFileUrl: '/uploads/keep.pdf',
        career: JSON.stringify({ artFair: [], solo: [{ year: '2025', content: '개인전' }], group: [] }),
        designConfig: JSON.stringify({ bg: 'white', heroImageId: 7, webTheme: true }),
      },
    });
  });

  it('★ 디자인만 바뀐다 — 약력·작가노트·경력·파일은 그대로', async () => {
    const r = await request.put('/api/portfolio/design').set('Authorization', artist)
      .send({ designConfig: { bg: 'ivory', coverLayout: 'matted', heroImageId: 7, webTheme: true, nameSource: 'nickname', contact: { phone: false } } });
    expect(r.status).toBe(200);
    expect(r.body.designConfig).toMatchObject({ bg: 'ivory', coverLayout: 'matted', heroImageId: 7, webTheme: true, nameSource: 'nickname', contact: { phone: false } });
    const p = await testPrisma.portfolio.findUnique({ where: { userId: 1 } });
    expect(p!.biography).toBe('원래 약력');
    expect(p!.statement).toBe('원래 작가노트');
    expect(p!.tagline).toBe('한 줄');
    expect(p!.portfolioFileUrl).toBe('/uploads/keep.pdf');
    expect(JSON.parse(p!.career!).solo).toHaveLength(1);
    expect(JSON.parse(p!.designConfig!).bg).toBe('ivory');
  });

  it('★ 다른 탭에서 글을 고친 뒤 디자인을 저장해도 고친 글이 남는다 (옛 전체 교체 경로의 사고)', async () => {
    // 탭 A 가 약력을 고쳤다
    await testPrisma.portfolio.update({ where: { userId: 1 }, data: { biography: '새로 고친 약력' } });
    // 탭 B(옛 캐시를 든 제작 화면)가 색을 바꾼다 — 디자인 경로는 글을 싣지 않으므로 되돌릴 수가 없다
    await request.put('/api/portfolio/design').set('Authorization', artist).send({ designConfig: { bg: 'sand' } });
    expect((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.biography).toBe('새로 고친 약력');
  });

  it('② 형태가 깨진 값은 400 — 조용히 초기화하지 않는다. null 을 명시하면 비운다', async () => {
    expect((await request.put('/api/portfolio/design').set('Authorization', artist).send({})).status).toBe(400);
    expect((await request.put('/api/portfolio/design').set('Authorization', artist).send({ designConfig: 'not-json' })).status).toBe(400);
    expect((await request.put('/api/portfolio/design').set('Authorization', artist).send({ designConfig: 123 })).status).toBe(400);
    expect((await request.put('/api/portfolio/design').set('Authorization', artist).send({ designConfig: { pad: 'x'.repeat(9000) } })).status).toBe(400);
    expect(JSON.parse((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.designConfig!).bg).toBe('white');
    const cleared = await request.put('/api/portfolio/design').set('Authorization', artist).send({ designConfig: null });
    expect(cleared.status).toBe(200);
    expect((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.designConfig).toBeNull();
  });

  it('작가만 — 비로그인 401, 갤러리 403. 포트폴리오가 아직 없는 작가는 새로 만들어진다', async () => {
    expect((await request.put('/api/portfolio/design').send({ designConfig: {} })).status).toBe(401);
    expect((await request.put('/api/portfolio/design').set('Authorization', gallery).send({ designConfig: {} })).status).toBe(403);
    const r = await request.put('/api/portfolio/design').set('Authorization', artist2).send({ designConfig: { bg: 'ink' } });
    expect(r.status).toBe(200);
    expect(JSON.parse((await testPrisma.portfolio.findUnique({ where: { userId: 2 } }))!.designConfig!).bg).toBe('ink');
    // 남의 포트폴리오는 그대로다
    expect(JSON.parse((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.designConfig!).bg).toBe('white');
  });
});

describe('만든 PDF 를 홈페이지에 올리기 — PUT /api/portfolio/file', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    await testPrisma.portfolio.create({ data: { userId: 1, biography: '약력', statement: '노트', designConfig: JSON.stringify({ bg: 'ivory' }) } });
  });

  it('파일 주소만 바뀐다 — 글·디자인은 그대로', async () => {
    const f = touch('set');
    const r = await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: f.url });
    expect(r.status).toBe(200);
    expect(r.body.portfolioFileUrl).toBe(f.url);
    const p = await testPrisma.portfolio.findUnique({ where: { userId: 1 } });
    expect(p).toMatchObject({ biography: '약력', statement: '노트', portfolioFileUrl: f.url });
    expect(JSON.parse(p!.designConfig!).bg).toBe('ivory');
    // 공개 홈페이지 응답에 실린다
    const pub = await request.get('/api/portfolio/1');
    expect(pub.body.portfolioFileUrl).toBe(f.url);
    f.remove();
  });

  it('③ 우리 저장소 주소만 — 외부 주소·이상한 스킴·빈 값은 400', async () => {
    for (const bad of ['https://evil.example.com/a.pdf', 'javascript:alert(1)', 'data:application/pdf;base64,AAAA', '/etc/passwd', '', null, 42]) {
      const r = await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: bad });
      expect(r.status, String(bad)).toBe(400);
    }
    expect((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.portfolioFileUrl).toBeNull();
  });

  it('작가만 — 비로그인 401, 갤러리 403', async () => {
    expect((await request.put('/api/portfolio/file').send({ portfolioFileUrl: '/uploads/a.pdf' })).status).toBe(401);
    expect((await request.put('/api/portfolio/file').set('Authorization', gallery).send({ portfolioFileUrl: '/uploads/a.pdf' })).status).toBe(403);
  });

  it('바꾸면 옛 파일은 지운다 (아무도 안 쓰는 파일)', async () => {
    const a = touch('old'), b = touch('new');
    await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: a.url });
    await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: b.url });
    await settle(() => !a.exists());
    expect(a.exists(), '옛 파일').toBe(false);
    expect(b.exists(), '새 파일').toBe(true);
    b.remove();
  });

  it('★ ④ 지원서가 가리키는 옛 파일은 지우지 않는다 — 두 저장 경로 모두', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const applied = touch('applied'), next = touch('next'), third = touch('third');
    await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: applied.url });
    // 이 파일로 지원해 뒀다(지원서는 주소를 복사해 든다)
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: ex.id, biography: '약력', portfolioFileUrl: applied.url } });

    // 새 경로(만들기 화면의 '홈페이지에도 올리기')
    await request.put('/api/portfolio/file').set('Authorization', artist).send({ portfolioFileUrl: next.url });
    await pause();
    expect(applied.exists(), '지원서가 쓰는 파일(파일 경로)').toBe(true);

    // 옛 경로(홈페이지 편집의 [파일] 묶음 — 전체 교체)도 같은 규칙이어야 한다
    await testPrisma.application.update({ where: { userId_exhibitionId: { userId: 1, exhibitionId: ex.id } }, data: { portfolioFileUrl: next.url } });
    await request.put('/api/portfolio').set('Authorization', artist).send({ biography: '약력', career: {}, portfolioFileUrl: third.url });
    await pause();
    expect(next.exists(), '지원서가 쓰는 파일(전체 저장 경로)').toBe(true);

    // 지원서가 더는 가리키지 않으면 그때는 지운다
    await testPrisma.application.update({ where: { userId_exhibitionId: { userId: 1, exhibitionId: ex.id } }, data: { portfolioFileUrl: null } });
    await request.put('/api/portfolio').set('Authorization', artist).send({ biography: '약력', career: {}, portfolioFileUrl: null });
    await settle(() => !third.exists());
    expect(third.exists()).toBe(false);
    applied.remove(); next.remove();
  });
});

describe('PDF 저장 기록 — POST /api/portfolio/exports', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });
  const log = (auth: string | null, body: unknown) => {
    const r = request.post('/api/portfolio/exports').send(body as object);
    return auth ? r.set('Authorization', auth) : r;
  };

  it('저장할 때마다 한 줄 — 날짜는 서버의 KST 오늘', async () => {
    expect((await log(artist, { method: 'download', pages: 12, works: 30, uploaded: true })).status).toBe(204);
    expect((await log(artist, { method: 'print', pages: 12, works: 30 })).status).toBe(204);
    const rows = await testPrisma.portfolioExport.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userId: 1, method: 'download', pages: 12, works: 30, uploaded: true });
    expect(rows[1]).toMatchObject({ method: 'print', uploaded: false });
    expect(dayKey(rows[0]!.day)).toBe(dayKey(kstDay()));
  });

  it('형식이 틀리면 400 — 아무 값이나 쌓이지 않는다', async () => {
    const bads: unknown[] = [
      {}, { method: 'email', pages: 3, works: 3 }, { method: 'download', pages: 0, works: 3 }, { method: 'download', pages: 3.5, works: 3 },
      { method: 'download', pages: '3', works: 3 }, { method: 'download', pages: 3, works: -1 }, { method: 'download', pages: 3, works: 100000 },
      { method: 'download', pages: 99999, works: 3 },
    ];
    for (const b of bads) expect((await log(artist, b)).status, JSON.stringify(b)).toBe(400);
    expect(await testPrisma.portfolioExport.count()).toBe(0);
  });

  it('작가만 — 비로그인 401, 갤러리·관리자 403', async () => {
    const ok = { method: 'download', pages: 3, works: 3 };
    expect((await log(null, ok)).status).toBe(401);
    expect((await log(gallery, ok)).status).toBe(403);
    expect((await log(admin, ok)).status).toBe(403);
    expect(await testPrisma.portfolioExport.count()).toBe(0);
  });

  it('하루 한도를 넘으면 받되 적지 않는다 — 저장은 막지 않는다(204)', async () => {
    const day = kstDay();
    await testPrisma.portfolioExport.createMany({ data: Array.from({ length: EXPORT_DAILY_CAP }, () => ({ day, userId: 1, method: 'download', pages: 1, works: 1 })) });
    expect((await log(artist, { method: 'download', pages: 3, works: 3 })).status).toBe(204);
    expect(await testPrisma.portfolioExport.count({ where: { userId: 1 } })).toBe(EXPORT_DAILY_CAP);
    // 다른 작가는 영향이 없다
    expect((await log(artist2, { method: 'download', pages: 3, works: 3 })).status).toBe(204);
    expect(await testPrisma.portfolioExport.count({ where: { userId: 2 } })).toBe(1);
  });

  it('★ 동시에 몰려도 하루 한도를 넘지 않는다 — 세고 나서 쓰는 경합(e2e 65 R9 실측: 26개씩 5번 → 104줄)', async () => {
    const results = await Promise.all(Array.from({ length: EXPORT_DAILY_CAP + 20 }, () =>
      recordExport(1, { method: 'download', pages: 3, works: 2, uploaded: false })));
    expect(results.filter(Boolean)).toHaveLength(EXPORT_DAILY_CAP);
    expect(await testPrisma.portfolioExport.count({ where: { userId: 1 } })).toBe(EXPORT_DAILY_CAP);
    // 라우트로 동시에 보내도 전부 204 — 기록 때문에 저장이 실패하지 않는다
    const codes = (await Promise.all(Array.from({ length: 10 }, () => log(artist2, { method: 'print', pages: 2, works: 1 })))).map((r) => r.status);
    expect(codes.every((c) => c === 204)).toBe(true);
    expect(await testPrisma.portfolioExport.count({ where: { userId: 2 } })).toBe(10);
  });
});

describe('저장 통계 — GET /api/admin/stats/portfolio-exports', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });
  const stats = (days: number, auth = admin) => request.get(`/api/admin/stats/portfolio-exports?days=${days}`).set('Authorization', auth);

  it('⑥ Admin 만 — 작가·갤러리 403, 비로그인 401, 기간이 이상하면 400', async () => {
    expect((await request.get('/api/admin/stats/portfolio-exports')).status).toBe(401);
    expect((await stats(7, artist)).status).toBe(403);
    expect((await stats(7, gallery)).status).toBe(403);
    expect((await stats(0)).status).toBe(400);
    expect((await request.get('/api/admin/stats/portfolio-exports?days=abc').set('Authorization', admin)).status).toBe(400);
  });

  it('기록이 없으면 전부 0 · since 는 null', async () => {
    const r = await stats(7);
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(7);
    expect(r.body.rows.every((x: { total: number }) => x.total === 0)).toBe(true);
    expect(r.body.since).toBeNull();
    expect(r.body.totals).toEqual({ saves: 0, artists: 0 });
  });

  it('날짜별 횟수·작가 수(사람 단위)·방식별 — 기록 없는 날은 0 으로 채운다', async () => {
    const now = new Date('2026-10-03T03:00:00Z');           // KST 10-03 12:00
    const twoDaysAgo = new Date('2026-10-01T03:00:00Z');
    await recordExport(1, { method: 'download', pages: 10, works: 8, uploaded: true }, twoDaysAgo);
    await recordExport(1, { method: 'download', pages: 10, works: 8, uploaded: false }, now);
    await recordExport(1, { method: 'pptx', pages: 10, works: 8, uploaded: false }, now);
    await recordExport(2, { method: 'print', pages: 5, works: 4, uploaded: false }, now);

    const s = await dailyExportStats(3, now);
    expect(s.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(s.rows[0]).toMatchObject({ total: 1, artists: 1, download: 1, print: 0, pptx: 0, uploaded: 1 });
    expect(s.rows[1]).toMatchObject({ total: 0, artists: 0 });
    // 한 작가가 두 번 저장해도 작가 수는 1 — 그날 2명이 3번
    expect(s.rows[2]).toMatchObject({ total: 3, artists: 2, download: 1, print: 1, pptx: 1, uploaded: 0 });
    expect(s.since).toBe('2026-10-01');
    expect(s.totals).toEqual({ saves: 4, artists: 2 });
  });

  it('날짜는 KST — UTC 15시(=KST 자정)를 넘으면 다음 날에 찍힌다', async () => {
    await recordExport(1, { method: 'download', pages: 1, works: 1, uploaded: false }, new Date('2026-10-02T14:59:00Z'));   // KST 10-02 23:59
    await recordExport(1, { method: 'download', pages: 1, works: 1, uploaded: false }, new Date('2026-10-02T15:01:00Z'));   // KST 10-03 00:01
    const s = await dailyExportStats(2, new Date('2026-10-03T01:00:00Z'));
    expect(s.rows.map((r) => [r.date, r.total])).toEqual([['2026-10-02', 1], ['2026-10-03', 1]]);
  });

  it('탈퇴 등으로 작가가 지워져도 저장 횟수는 남는다(작가 수에서만 빠진다)', async () => {
    const now = new Date('2026-10-03T03:00:00Z');
    await recordExport(2, { method: 'download', pages: 1, works: 1, uploaded: false }, now);
    await testPrisma.user.delete({ where: { id: 2 } });
    const s = await dailyExportStats(1, now);
    expect(s.rows[0]).toMatchObject({ total: 1, artists: 0 });
    expect(s.totals).toEqual({ saves: 1, artists: 0 });
  });

  it('응답 모양 — 화면이 쓰는 키', async () => {
    await request.post('/api/portfolio/exports').set('Authorization', artist).send({ method: 'download', pages: 7, works: 8, uploaded: true });
    const r = await stats(1);
    expect(r.body.rows[0]).toEqual({ date: dayKey(kstDay()), total: 1, artists: 1, download: 1, print: 0, pptx: 0, uploaded: 1 });
    expect(r.body.since).toBe(dayKey(kstDay()));
    expect(r.body.totals).toEqual({ saves: 1, artists: 1 });
  });
});

describe('전체 저장(PUT /api/portfolio)은 파일을 보냈을 때만 바꾼다', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
  });

  it('★ 글만 보내면 파일은 그대로 — 다른 탭의 편집 화면이 방금 올린 PDF 를 지우지 않는다', async () => {
    const f = touch('keep');
    await testPrisma.portfolio.create({ data: { userId: 1, biography: '옛 약력', portfolioFileUrl: f.url } });
    const r = await request.put('/api/portfolio').set('Authorization', artist).send({ biography: '새 약력', career: {}, statement: '노트' });
    expect(r.status).toBe(200);
    expect(r.body.portfolioFileUrl).toBe(f.url);
    await pause();
    expect(f.exists(), '보내지 않은 파일').toBe(true);
    const p = await testPrisma.portfolio.findUnique({ where: { userId: 1 } });
    expect(p).toMatchObject({ biography: '새 약력', portfolioFileUrl: f.url });
    f.remove();
  });

  it('키를 보내면 예전과 같다 — null 이면 떼고(파일 삭제), 주소면 바꾼다', async () => {
    const a = touch('a'), b = touch('b');
    await testPrisma.portfolio.create({ data: { userId: 1, biography: '약력', portfolioFileUrl: a.url } });
    await request.put('/api/portfolio').set('Authorization', artist).send({ biography: '약력', career: {}, portfolioFileUrl: b.url });
    await settle(() => !a.exists());
    expect(a.exists()).toBe(false);
    expect((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.portfolioFileUrl).toBe(b.url);
    await request.put('/api/portfolio').set('Authorization', artist).send({ biography: '약력', career: {}, portfolioFileUrl: null });
    await settle(() => !b.exists());
    expect(b.exists()).toBe(false);
    expect((await testPrisma.portfolio.findUnique({ where: { userId: 1 } }))!.portfolioFileUrl).toBeNull();
  });

  it('포트폴리오가 아직 없는 작가가 파일 없이 저장하면 파일은 비어 있다', async () => {
    const r = await request.put('/api/portfolio').set('Authorization', artist2).send({ biography: '첫 약력', career: {} });
    expect(r.status).toBe(200);
    expect(r.body.portfolioFileUrl ?? null).toBeNull();
  });
});
