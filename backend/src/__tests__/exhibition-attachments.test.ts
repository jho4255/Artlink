/**
 * 공모 첨부파일 (2026-10-08 사용자 결정) — 갤러리·관리자가 공고를 올릴 때 모집 요강·지원서 양식 같은 파일을 붙인다.
 * 누구나(비회원 포함) 공고 상세에서 내려받는다. 승인 뒤에도 공모 소개처럼 운영자가 바로 고친다.
 * 규칙은 lib/exhibitionAttachments.ts · 업로드는 POST /api/upload/attachment.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { request, cleanDb, seedUsers, seedGallery, seedExhibition, authToken, testPrisma } from './helpers';
import { attachmentDisposition, cleanAttachmentName, parseAttachments, readAttachments, ATTACHMENT_MAX } from '../lib/exhibitionAttachments';
import { deleteUploadedFile } from '../lib/storage';

const DAY = 24 * 3600_000;
const future = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const OWNER = () => authToken(3, 'GALLERY');
const ADMIN = () => authToken(4, 'ADMIN');
const ARTIST = () => authToken(1, 'ARTIST');

const FILES = [
  { url: '/uploads/111-guide.pdf', name: '2026 모집 요강.pdf', size: 120_000 },
  { url: '/uploads/222-form.hwp', name: '지원서 양식.hwp', size: 34_000 },
];

const body = (galleryId: number, extra: Record<string, unknown> = {}) => ({
  title: '첨부 공모', type: 'GROUP', deadline: future(10), recruitOnly: true, capacity: 3, region: 'SEOUL', description: '소개', galleryId, ...extra,
});

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

describe('등록 — 갤러리·아트링크 주최', () => {
  it('갤러리 공고에 첨부를 붙이면 저장되고, 승인 뒤 **비회원**도 상세에서 받는다', async () => {
    const g = await seedGallery();
    const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, { attachments: FILES }));
    expect(res.status).toBe(201);
    // 승인 전에는 비회원에게 상세 자체가 안 열린다(규칙 23) — 관리자 승인 화면에서 먼저 본다
    const pending = await request.get('/api/approvals').set('Authorization', `Bearer ${ADMIN()}`);
    expect(pending.body.pendingExhibitions[0].attachments).toEqual(FILES);
    await testPrisma.exhibition.update({ where: { id: res.body.id }, data: { status: 'APPROVED' } });
    const detail = await request.get(`/api/exhibitions/${res.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.attachments).toEqual(FILES);
  });

  it('첨부 없이 올리면 빈 배열', async () => {
    const g = await seedGallery();
    const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id));
    await testPrisma.exhibition.update({ where: { id: res.body.id }, data: { status: 'APPROVED' } });
    expect((await request.get(`/api/exhibitions/${res.body.id}`)).body.attachments).toEqual([]);
  });

  it('아트링크 주최 공고에도 붙는다', async () => {
    const { galleryId: _g, ...rest } = body(0, { attachments: [FILES[0]] });
    void _g;
    const res = await request.post('/api/exhibitions/hosted').set('Authorization', `Bearer ${ADMIN()}`).send({ ...rest, galleryIds: [] });
    expect(res.status).toBe(201);
    expect((await request.get(`/api/exhibitions/${res.body.id}`)).body.attachments).toEqual([FILES[0]]);
  });

  it('★ 외부 주소는 400 — 공고 상세가 남의 파일을 우리 이름으로 내려주면 안 된다', async () => {
    const g = await seedGallery();
    for (const url of ['https://evil.example/malware.exe', '//evil.example/a.pdf', '/api/auth/me', '/uploads/../api/x', 'javascript:alert(1)']) {
      const res = await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, { attachments: [{ url, name: 'a.pdf' }] }));
      expect(res.status, url).toBe(400);
    }
    expect(await testPrisma.exhibition.count()).toBe(0);
  });

  it(`${ATTACHMENT_MAX}개까지 — 넘으면 400`, async () => {
    const g = await seedGallery();
    const many = Array.from({ length: ATTACHMENT_MAX + 1 }, (_, i) => ({ url: `/uploads/${i}.pdf`, name: `${i}.pdf` }));
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, { attachments: many }))).status).toBe(400);
    expect((await request.post('/api/exhibitions').set('Authorization', `Bearer ${OWNER()}`).send(body(g.id, { attachments: many.slice(0, ATTACHMENT_MAX) }))).status).toBe(201);
  });
});

describe('고치기 — PATCH /exhibitions/:id/attachments (공모 소개와 같은 권한)', () => {
  it('운영 갤러리·관리자는 바꾸고, 다른 갤러리·작가·비회원은 못 바꾼다', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const url = `/api/exhibitions/${ex.id}/attachments`;
    const mine = await request.patch(url).set('Authorization', `Bearer ${OWNER()}`).send({ attachments: FILES });
    expect(mine.status).toBe(200);
    expect(mine.body.attachments).toEqual(FILES);
    expect((await request.get(`/api/exhibitions/${ex.id}`)).body.attachments).toEqual(FILES);

    const other = await testPrisma.user.create({ data: { email: 'other-g@test.com', name: 'o', role: 'GALLERY' } });
    await seedGallery(other.id);
    expect((await request.patch(url).set('Authorization', `Bearer ${authToken(other.id, 'GALLERY')}`).send({ attachments: [] })).status).toBeGreaterThanOrEqual(403);
    expect((await request.patch(url).set('Authorization', `Bearer ${ARTIST()}`).send({ attachments: [] })).status).toBeGreaterThanOrEqual(403);
    expect((await request.patch(url).send({ attachments: [] })).status).toBe(401);

    // 관리자가 빼면 빈 배열(DB 는 NULL)
    const cleared = await request.patch(url).set('Authorization', `Bearer ${ADMIN()}`).send({ attachments: [] });
    expect(cleared.status).toBe(200);
    expect((await testPrisma.exhibition.findUniqueOrThrow({ where: { id: ex.id } })).attachments).toBeNull();
    expect((await request.get(`/api/exhibitions/${ex.id}`)).body.attachments).toEqual([]);
  });

  it('같은 주소가 두 번이면 한 번만, 이름은 경로·제어 문자를 빼고 NFC 로', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    const nfd = '모집요강.pdf'.normalize('NFD');
    const res = await request.patch(`/api/exhibitions/${ex.id}/attachments`).set('Authorization', `Bearer ${OWNER()}`)
      .send({ attachments: [{ url: '/uploads/1.pdf', name: `../../${nfd}\n` }, { url: '/uploads/1.pdf', name: 'dup.pdf' }, { url: '/uploads/2.zip', name: '' }] });
    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([
      { url: '/uploads/1.pdf', name: '.._.._모집요강.pdf', size: null },
      { url: '/uploads/2.zip', name: '첨부파일.zip', size: null },
    ]);
  });

  it('★ DB 에 이상한 값이 들어 있어도 상세는 500 이 아니다 — 쓸 수 있는 줄만', async () => {
    const g = await seedGallery();
    const ex = await seedExhibition(g.id);
    await testPrisma.exhibition.update({
      where: { id: ex.id },
      data: { attachments: [{ url: 'https://evil.example/x.pdf', name: 'x' }, 'oops', null, { url: '/uploads/ok.pdf', name: 'ok.pdf', size: 'big' }] as any },
    });
    const res = await request.get(`/api/exhibitions/${ex.id}`);
    expect(res.status).toBe(200);
    expect(res.body.attachments).toEqual([{ url: '/uploads/ok.pdf', name: 'ok.pdf', size: null }]);
  });
});

describe('업로드 — POST /api/upload/attachment', () => {
  const uploadsDir = path.join(__dirname, '../../uploads');
  const made: string[] = [];
  afterAll(async () => {
    for (const url of made) await deleteUploadedFile(url);
  });
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  it('갤러리가 PDF·한글을 올리면 원래 이름·크기와 우리 저장소 주소를 돌려준다', async () => {
    const res = await request.post('/api/upload/attachment').set('Authorization', `Bearer ${OWNER()}`)
      .attach('file', pdf, { filename: '2026 모집 요강.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    made.push(res.body.url);
    expect(res.body.url).toMatch(/^\/uploads\/.+\.pdf$/);
    expect(res.body.originalName).toBe('2026 모집 요강.pdf');
    expect(res.body.size).toBe(pdf.length);
    expect(fs.existsSync(path.join(uploadsDir, path.basename(res.body.url)))).toBe(true);
    // 한글 파일은 브라우저가 형식을 모른다며 octet-stream 으로 보낸다
    const hwp = await request.post('/api/upload/attachment').set('Authorization', `Bearer ${ADMIN()}`)
      .attach('file', Buffer.from('HWP Document File'), { filename: '지원서.hwp', contentType: 'application/octet-stream' });
    expect(hwp.status).toBe(200);
    made.push(hwp.body.url);
  });

  it('★ PNG 는 그대로(.png) — 사진 업로드처럼 JPEG 로 바꾸지 않는다', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const res = await request.post('/api/upload/attachment').set('Authorization', `Bearer ${OWNER()}`)
      .attach('file', png, { filename: '공간 도면.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    made.push(res.body.url);
    expect(res.body.url).toMatch(/\.png$/);
  });

  it('작가·비회원은 못 올리고, 허용하지 않는 형식은 400', async () => {
    expect((await request.post('/api/upload/attachment').set('Authorization', `Bearer ${ARTIST()}`)
      .attach('file', pdf, { filename: 'a.pdf', contentType: 'application/pdf' })).status).toBe(403);
    expect((await request.post('/api/upload/attachment').attach('file', pdf, { filename: 'a.pdf', contentType: 'application/pdf' })).status).toBe(401);
    const exe = await request.post('/api/upload/attachment').set('Authorization', `Bearer ${OWNER()}`)
      .attach('file', Buffer.from('MZ'), { filename: 'setup.exe', contentType: 'application/octet-stream' });
    expect(exe.status).toBe(400);
    const disguised = await request.post('/api/upload/attachment').set('Authorization', `Bearer ${OWNER()}`)
      .attach('file', Buffer.from('<html>'), { filename: 'guide.pdf', contentType: 'text/html' });
    expect(disguised.status).toBe(400);
  });
});

describe('규칙 함수', () => {
  it('Content-Disposition — ASCII 대체 이름 + UTF-8 원래 이름', () => {
    const v = attachmentDisposition('2026 모집 "요강".pdf');
    expect(v).toMatch(/^attachment; filename="2026 __ __+\.pdf"; filename\*=UTF-8''/);
    expect(v).toContain(encodeURIComponent('모집'));
    expect(v).not.toMatch(/[^\x20-\x7e]/);   // 헤더는 ASCII 만
    expect(decodeURIComponent(v.split("UTF-8''")[1]!)).toBe('2026 모집 "요강".pdf');
  });

  it('이름이 길면 확장자를 살려 자른다', () => {
    const long = `${'가'.repeat(200)}.hwpx`;
    const n = cleanAttachmentName(long);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith('.hwpx')).toBe(true);
  });

  it('parse 는 틀리면 던지고, read 는 건너뛴다', () => {
    expect(() => parseAttachments('x')).toThrow();
    expect(() => parseAttachments([{ url: 'https://evil.example/a.pdf' }])).toThrow();
    expect(parseAttachments(null)).toEqual([]);
    expect(readAttachments('x')).toEqual([]);
    expect(readAttachments([{ url: '/uploads/a.pdf', name: 'a.pdf', size: 10 }, { url: 'ftp://x' }])).toEqual([{ url: '/uploads/a.pdf', name: 'a.pdf', size: 10 }]);
  });
});
