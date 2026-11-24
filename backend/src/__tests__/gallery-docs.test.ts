/**
 * 갤러리 결과물(작품 리스트·출품 자료·정산서·지원서 PDF)이 서버에 기대는 것 (2026-11-24, CLAUDE.md 규칙 92).
 *  - 대체 글꼴 `GET /api/fonts/fallback` — 한자·이모지를 쓰인 글자만 담은 TTF 로(구글 글꼴을 서버가 대신 받는다)
 *  - 정산 응답의 `respondedAt` — 정산서에 '작가가 확인한 날'을 찍는다
 *  - 지원자 목록의 `handle` — 지원서 PDF 의 홈페이지 링크
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { request, testPrisma, authToken, cleanDb, seedUsers, seedGallery, seedExhibition } from './helpers';
import { FALLBACK_MAX_CHARS, cleanFallbackText, clearFallbackFontCache, looksLikeFont } from '../lib/fallbackFont';

const ownerTok = authToken(3, 'GALLERY');
const a1 = authToken(1, 'ARTIST');

/** 가짜 TrueType — 앞 4바이트(00 01 00 00)만 맞춘다 */
const TTF = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(60, 7)]);
const CSS = '@font-face { font-family: "Noto Sans KR"; src: url(https://fonts.gstatic.com/l/font?kit=abc&skey=1) format("truetype"); }';

function stubGoogle(opts: { css?: string; font?: Buffer; fail?: boolean } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    if (opts.fail) throw new TypeError('fetch failed');
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://fonts.googleapis.com/')) return new Response(opts.css ?? CSS, { status: 200, headers: { 'content-type': 'text/css' } });
    if (url.startsWith('https://fonts.gstatic.com/')) return new Response(new Uint8Array(opts.font ?? TTF), { status: 200 });
    return new Response('no', { status: 404 });
  });
}

describe('대체 글꼴 GET /api/fonts/fallback', () => {
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    clearFallbackFontCache();
  });
  afterEach(() => vi.restoreAllMocks());

  const get = (q: string, tok: string | null = a1) => {
    const r = request.get(`/api/fonts/fallback?${q}`);
    return tok ? r.set('Authorization', `Bearer ${tok}`) : r;
  };

  it('로그인한 사람만(아무나 쓰는 중계가 되지 않게)', async () => {
    expect((await get('set=cjk&weight=400&text=展', null)).status).toBe(401);
  });

  it('글꼴 종류·굵기·글자가 틀리면 400 — 바깥에 묻지 않는다', async () => {
    const spy = stubGoogle();
    expect((await get('set=serif&weight=400&text=展')).status).toBe(400);
    expect((await get('set=cjk&weight=500&text=展')).status).toBe(400);
    expect((await get('set=cjk&weight=400&text=abc')).status).toBe(400);    // 본문 글꼴에 있는 글자뿐
    const many = Array.from({ length: FALLBACK_MAX_CHARS + 1 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    expect((await get(`set=cjk&weight=400&text=${encodeURIComponent(many)}`)).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('★ 쓰인 글자만 정리해 묻고(문장은 안 보낸다) TTF 를 그대로 내려준다 · 같은 글자는 다시 묻지 않는다', async () => {
    const spy = stubGoogle();
    const res = await get(`set=cjk&weight=700&text=${encodeURIComponent('개인展 展 書A')}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('font/ttf');
    expect(Buffer.compare(res.body as Buffer, TTF)).toBe(0);
    const [cssUrl, init] = spy.mock.calls[0]!;
    expect(String(cssUrl)).toContain('family=Noto%20Sans%20KR:wght@700');
    // 한글('개','인')은 서버가 정리하며 남지만(본문 글꼴 판단은 화면이 한다) ASCII·공백·중복은 빠진다
    expect(decodeURIComponent(String(cssUrl).split('text=')[1]!)).toBe(cleanFallbackText('개인展 展 書A'));
    expect((init as RequestInit).headers).toMatchObject({ 'User-Agent': 'Mozilla/5.0' });
    expect(spy).toHaveBeenCalledTimes(2);   // CSS 한 번 + 글꼴 한 번
    expect((await get(`set=cjk&weight=700&text=${encodeURIComponent('書展인개')}`)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);   // 같은 글자 모음 → 서버 메모리에서
  });

  it('구글에 못 닿거나 글꼴이 아니면 502(화면은 문서를 만들고 빈칸이 생겼다고 알린다)', async () => {
    stubGoogle({ fail: true });
    expect((await get('set=emoji&weight=400&text=❤')).status).toBe(502);
    vi.restoreAllMocks();
    stubGoogle({ font: Buffer.from('<html>blocked</html>') });
    expect((await get('set=emoji&weight=400&text=❤')).status).toBe(502);
    vi.restoreAllMocks();
    // CSS 가 gstatic 이 아닌 주소를 가리키면 따라가지 않는다
    stubGoogle({ css: 'src: url(https://evil.example/x.ttf)' });
    expect((await get('set=emoji&weight=400&text=❤')).status).toBe(502);
  });

  it('글자 정리 · 글꼴 판정', () => {
    expect(cleanFallbackText('展 展\n書 abc')).toBe('展書');
    expect(cleanFallbackText(123)).toBeNull();
    expect(cleanFallbackText('   ')).toBeNull();
    expect(looksLikeFont(TTF)).toBe(true);
    expect(looksLikeFont(Buffer.from('OTTO0000000000'))).toBe(true);
    expect(looksLikeFont(Buffer.from('wOF2000000000000'))).toBe(false);
  });
});

describe('정산서·지원서가 읽는 값', () => {
  let exId: number;
  beforeEach(async () => {
    await cleanDb();
    await seedUsers();
    const gallery = await seedGallery(3);
    exId = (await seedExhibition(gallery.id)).id;
  });

  it('정산 응답에 작가가 확인한 시각(respondedAt) — 확인 전이면 null', async () => {
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'ACCEPTED' } });
    await request.put(`/api/operations/${exId}/me`).set('Authorization', `Bearer ${a1}`)
      .send({ artworkList: [{ title: '봄', size: '53x45.5', medium: '캔버스에 유채', year: '2026', price: '1200000' }], cv: { nameKo: '작가' }, note: { statement: '노트', sections: [] } });
    await testPrisma.exhibition.update({ where: { id: exId }, data: { recruitmentClosed: true, confirmed: true, ended: true } });
    const op = (m: 'get' | 'put' | 'post', p: string) => (request as any)[m](`/api/operations/${exId}${p}`).set('Authorization', `Bearer ${ownerTok}`);
    expect((await op('put', '/settlement').send({ sales: [{ artistUserId: 1, artworkIndex: 0, title: '봄', soldPrice: 1200000, paymentMethod: 'CARD' }], ratios: [{ artistUserId: 1, galleryRatio: 30 }] })).status).toBe(200);
    expect((await op('post', '/settlement/request')).status).toBe(200);

    let row = (await op('get', '/settlement')).body.artists.find((a: any) => a.user.id === 1);
    expect(row.approval).toMatchObject({ status: 'PENDING', respondedAt: null });

    const before = Date.now();
    expect((await request.post(`/api/operations/${exId}/settlement/respond`).set('Authorization', `Bearer ${a1}`).send({ approve: true })).status).toBe(200);
    row = (await op('get', '/settlement')).body.artists.find((a: any) => a.user.id === 1);
    expect(row.approval.status).toBe('APPROVED');
    expect(new Date(row.approval.respondedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const mine = await request.get(`/api/operations/${exId}/my-settlement`).set('Authorization', `Bearer ${a1}`);
    expect(mine.body.myApproval).toMatchObject({ status: 'APPROVED', autoApproved: false });
    expect(mine.body.myApproval.respondedAt).toBe(row.approval.respondedAt);
  });

  it('지원자 목록에 홈페이지 주소(handle) — 지원서 PDF 의 링크', async () => {
    await testPrisma.user.update({ where: { id: 1 }, data: { handle: 'artist.one' } });
    await testPrisma.application.create({ data: { userId: 1, exhibitionId: exId, status: 'PENDING' } });
    const res = await request.get(`/api/exhibitions/${exId}/applications`).set('Authorization', `Bearer ${ownerTok}`);
    expect(res.status).toBe(200);
    expect(res.body[0].user.handle).toBe('artist.one');
  });
});
