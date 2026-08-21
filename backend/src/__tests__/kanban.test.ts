/**
 * Admin 할 일 보드 API.
 *
 * 이 파일의 첫 블록('접근 제어')이 가장 중요하다. 보드·항목·댓글에는 내부 회의 내용이
 * 그대로 들어가므로, 엔드포인트 하나라도 authorize('ADMIN') 이 빠지면 그 즉시 운영 논의가 샌다.
 * 새 엔드포인트를 추가하면 여기 목록에도 반드시 넣을 것.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { request, authToken, cleanDb, seedUsers, testPrisma } from './helpers';
import kanbanRouter from '../routes/kanban';

const adminToken = () => authToken(4, 'ADMIN');
const artistToken = () => authToken(1, 'ARTIST');
const galleryToken = () => authToken(3, 'GALLERY');

const AS_ADMIN = () => ({ Authorization: `Bearer ${adminToken()}` });

async function makeBoard(title = '운영 회의') {
  const res = await request.post('/api/kanban/boards').set(AS_ADMIN()).send({ title });
  return res.body;
}

async function makeSub(cardId: number, title: string) {
  const res = await request.post(`/api/kanban/cards/${cardId}/subtasks`).set(AS_ADMIN()).send({ title });
  return res.body;
}

/** 보드 상세에서 특정 항목의 세부항목을 화면 순서 그대로 가져온다. */
async function subsOf(boardId: number, cardId: number) {
  const res = await request.get(`/api/kanban/boards/${boardId}`).set(AS_ADMIN());
  return res.body.cards.find((c: any) => c.id === cardId).subtasks;
}

async function makeItem(boardId: number, body: Record<string, unknown> = {}) {
  const res = await request.post(`/api/kanban/boards/${boardId}/cards`).set(AS_ADMIN())
    .send({ title: '할 일', ...body });
  return res.body;
}

/** 보드 상세를 가져와 화면 순서 그대로의 id 배열을 만든다. */
async function orderOf(boardId: number): Promise<number[]> {
  const res = await request.get(`/api/kanban/boards/${boardId}`).set(AS_ADMIN());
  return res.body.cards.map((c: any) => c.id);
}

beforeEach(async () => {
  await cleanDb();
  await seedUsers();
});

/** 라우터에 실제로 등록된 (method, path) 를 읽어 온다. */
function registeredRoutes(): [string, string][] {
  const out: [string, string][] = [];
  for (const layer of (kanbanRouter as any).stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) out.push([method, layer.route.path]);
  }
  return out;
}

describe('접근 제어 — Admin 외 전부 차단', () => {
  // 라우터 전체가 authenticate + authorize('ADMIN') 뒤에 있는지 확인한다.
  const endpoints: [string, string][] = [
    ['get', '/api/kanban/members'],
    ['get', '/api/kanban/boards'],
    ['get', '/api/kanban/boards/1'],
    ['post', '/api/kanban/boards'],
    ['patch', '/api/kanban/boards/1'],
    ['patch', '/api/kanban/boards/1/move'],
    ['patch', '/api/kanban/boards/1/reorder'],
    ['delete', '/api/kanban/boards/1'],
    ['post', '/api/kanban/boards/1/cards'],
    ['patch', '/api/kanban/cards/1'],
    ['delete', '/api/kanban/cards/1'],
    ['post', '/api/kanban/cards/1/subtasks'],
    ['patch', '/api/kanban/subtasks/1'],
    ['delete', '/api/kanban/subtasks/1'],
    ['get', '/api/kanban/cards/1/comments'],
    ['post', '/api/kanban/cards/1/comments'],
    ['delete', '/api/kanban/comments/1'],
  ];

  it.each(endpoints)('비로그인은 401 — %s %s', async (method, url) => {
    const res = await (request as any)[method](url).send({});
    expect(res.status).toBe(401);
  });

  it.each(endpoints)('ARTIST 는 403 — %s %s', async (method, url) => {
    const res = await (request as any)[method](url).set('Authorization', `Bearer ${artistToken()}`).send({});
    expect(res.status).toBe(403);
  });

  it.each(endpoints)('GALLERY 는 403 — %s %s', async (method, url) => {
    const res = await (request as any)[method](url).set('Authorization', `Bearer ${galleryToken()}`).send({});
    expect(res.status).toBe(403);
  });

  /**
   * 위 목록은 손으로 관리된다 — 엔드포인트를 새로 만들고 여기 안 넣으면 그 하나만 검사망을 빠져나간다.
   * 그래서 라우터에 **실제로 등록된 경로**와 대조한다. 새 엔드포인트를 추가하면 이 테스트가 먼저 깨진다.
   */
  it('라우터에 등록된 엔드포인트가 빠짐없이 검사 목록에 있다', () => {
    const tested = new Set(endpoints.map(([m, u]) => `${m} ${u.replace('/api/kanban', '').replace(/\/\d+/g, '/:id')}`));
    const missing = registeredRoutes()
      .map(([m, p]) => `${m} ${p.replace(/:\w+/g, ':id')}`)
      .filter(sig => !tested.has(sig));
    expect(missing).toEqual([]);
  });

  it('존재하는 보드라도 갤러리에게는 내용이 한 글자도 나가지 않는다', async () => {
    const board = await makeBoard('비공개 회의: 수수료 인상 검토');
    const res = await request.get(`/api/kanban/boards/${board.id}`).set('Authorization', `Bearer ${galleryToken()}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('수수료');
  });
});

describe('보드', () => {
  it('생성하면 진행 상황이 0으로 함께 온다', async () => {
    const res = await request.post('/api/kanban/boards').set(AS_ADMIN())
      .send({ title: '2026 상반기', description: '운영 회의' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('2026 상반기');
    expect(res.body.counts).toEqual({ done: 0, open: 0, total: 0 });
    expect(res.body.createdBy.id).toBe(4);
  });

  it('제목이 비면 400', async () => {
    const res = await request.post('/api/kanban/boards').set(AS_ADMIN()).send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  it('목록은 position 순, 새 보드는 뒤에 붙는다', async () => {
    await makeBoard('A'); await makeBoard('B'); await makeBoard('C');
    const res = await request.get('/api/kanban/boards').set(AS_ADMIN());
    expect(res.body.map((b: any) => b.title)).toEqual(['A', 'B', 'C']);
  });

  it('목록의 counts 가 완료/미완료와 맞는다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id);
    await makeItem(board.id);
    await makeItem(board.id);
    await request.patch(`/api/kanban/cards/${a.id}`).set(AS_ADMIN()).send({ done: true });

    const res = await request.get('/api/kanban/boards').set(AS_ADMIN());
    expect(res.body[0].counts).toEqual({ done: 1, open: 2, total: 3 });
  });

  it('목록 응답에 항목과 세부항목이 통째로 실려 온다 — 화면이 한 장뿐이라 보드별로 또 부르면 N+1 이 된다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id, { title: '할 일 A', assigneeId: 4 });
    await makeSub(item.id, '세부 1');

    const res = await request.get('/api/kanban/boards').set(AS_ADMIN());
    const got = res.body[0];
    expect(got.cards).toHaveLength(1);
    expect(got.cards[0].title).toBe('할 일 A');
    expect(got.cards[0].assignee.id).toBe(4);
    expect(got.cards[0].subtasks.map((s: any) => s.title)).toEqual(['세부 1']);
    expect(got.cards[0]._count.comments).toBe(0);
  });

  it('목록의 항목도 정렬된 상태로 온다 (안 한 일 먼저, 완료는 뒤)', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    await request.patch(`/api/kanban/cards/${a.id}`).set(AS_ADMIN()).send({ done: true });

    const res = await request.get('/api/kanban/boards').set(AS_ADMIN());
    expect(res.body[0].cards.map((c: any) => c.id)).toEqual([b.id, a.id]);
  });

  it('새 보드는 빈 항목 배열과 함께 온다 (화면이 undefined 를 만나지 않게)', async () => {
    const res = await request.post('/api/kanban/boards').set(AS_ADMIN()).send({ title: '새 보드' });
    expect(res.body.cards).toEqual([]);
  });

  it('순서를 옮기면 목록 순서가 바뀐다', async () => {
    const a = await makeBoard('A'); await makeBoard('B'); await makeBoard('C');
    await request.patch(`/api/kanban/boards/${a.id}/move`).set(AS_ADMIN()).send({ index: 2 });
    const res = await request.get('/api/kanban/boards').set(AS_ADMIN());
    expect(res.body.map((b: any) => b.title)).toEqual(['B', 'C', 'A']);
  });

  it('삭제하면 항목과 댓글까지 함께 사라진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN()).send({ body: '확인했습니다' });

    const res = await request.delete(`/api/kanban/boards/${board.id}`).set(AS_ADMIN());
    expect(res.status).toBe(200);
    expect(await testPrisma.kanbanCard.count()).toBe(0);
    expect(await testPrisma.kanbanComment.count()).toBe(0);
  });

  it('없는 보드는 404', async () => {
    const res = await request.get('/api/kanban/boards/9999').set(AS_ADMIN());
    expect(res.status).toBe(404);
  });
});

describe('항목', () => {
  it('추가하면 목록 맨 뒤에 붙는다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(await orderOf(board.id)).toEqual([a.id, b.id]);
    expect(a.doneAt).toBeNull();
  });

  it('제목이 비면 400', async () => {
    const board = await makeBoard();
    const res = await request.post(`/api/kanban/boards/${board.id}/cards`).set(AS_ADMIN()).send({ title: ' ' });
    expect(res.status).toBe(400);
  });

  it('담당자는 Admin 만 지정할 수 있다', async () => {
    const board = await makeBoard();
    const ok = await request.post(`/api/kanban/boards/${board.id}/cards`).set(AS_ADMIN())
      .send({ title: 'x', assigneeId: 4 });
    expect(ok.status).toBe(201);
    expect(ok.body.assignee.id).toBe(4);

    // 작가를 담당자로 넣으려는 시도 — 400 (Admin 전용 보드에 외부인이 엮이면 안 된다)
    const bad = await request.post(`/api/kanban/boards/${board.id}/cards`).set(AS_ADMIN())
      .send({ title: 'y', assigneeId: 1 });
    expect(bad.status).toBe(400);
  });

  it('탈퇴한 Admin 은 담당자로 지정할 수 없다', async () => {
    await testPrisma.user.create({
      data: { id: 50, email: 'gone@test.com', name: '탈퇴 관리자', role: 'ADMIN', deletedAt: new Date() },
    });
    const board = await makeBoard();
    const res = await request.post(`/api/kanban/boards/${board.id}/cards`).set(AS_ADMIN())
      .send({ title: 'x', assigneeId: 50 });
    expect(res.status).toBe(400);
  });

  it('마감일이 이상하면 400', async () => {
    const board = await makeBoard();
    const res = await request.post(`/api/kanban/boards/${board.id}/cards`).set(AS_ADMIN())
      .send({ title: 'x', dueDate: '이번주' });
    expect(res.status).toBe(400);
  });

  it('내용·담당자·마감일을 수정한다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const res = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN())
      .send({ title: '고친 제목', body: '회의 내용', assigneeId: 4, dueDate: '2026-09-01' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('고친 제목');
    expect(res.body.body).toBe('회의 내용');
    expect(res.body.assignee.id).toBe(4);
    expect(res.body.dueDate).toContain('2026-09-01');
  });

  it('담당자를 null 로 보내면 해제된다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id, { assigneeId: 4 });
    const res = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ assigneeId: null });
    expect(res.body.assignee).toBeNull();
  });

  it('삭제하면 댓글도 함께 사라진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN()).send({ body: 'note' });
    await request.delete(`/api/kanban/cards/${item.id}`).set(AS_ADMIN());
    expect(await testPrisma.kanbanComment.count()).toBe(0);
  });

  it('없는 항목은 404', async () => {
    const res = await request.patch('/api/kanban/cards/9999').set(AS_ADMIN()).send({ done: true });
    expect(res.status).toBe(404);
  });
});

describe('완료 체크 — doneAt 하나로만 판정', () => {
  it('체크하면 doneAt 이 찍힌다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const res = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ done: true });
    expect(res.body.doneAt).not.toBeNull();
  });

  it('체크를 풀면 doneAt 이 지워진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ done: true });
    const res = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ done: false });
    expect(res.body.doneAt).toBeNull();
  });

  it('이미 체크된 항목을 또 체크해도 시각이 덮어써지지 않는다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const first = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ done: true });
    const again = await request.patch(`/api/kanban/cards/${item.id}`).set(AS_ADMIN()).send({ done: true });
    expect(again.body.doneAt).toBe(first.body.doneAt);
  });

  it('체크해도 position 은 그대로다 — 체크를 풀면 원래 자리로 돌아와야 한다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    const c = await makeItem(board.id, { title: 'C' });

    await request.patch(`/api/kanban/cards/${b.id}`).set(AS_ADMIN()).send({ done: true });
    const mid = await testPrisma.kanbanCard.findUnique({ where: { id: b.id } });
    expect(mid!.position).toBe(1); // 옮기지 않았다

    // 체크 상태에선 뒤로 밀려 보이고
    expect(await orderOf(board.id)).toEqual([a.id, c.id, b.id]);

    // 풀면 원래 자리(A 와 C 사이)로
    await request.patch(`/api/kanban/cards/${b.id}`).set(AS_ADMIN()).send({ done: false });
    expect(await orderOf(board.id)).toEqual([a.id, b.id, c.id]);
  });

  it('완료 항목은 최근에 체크한 것부터 뒤에 쌓인다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    const c = await makeItem(board.id, { title: 'C' });

    await request.patch(`/api/kanban/cards/${a.id}`).set(AS_ADMIN()).send({ done: true });
    await new Promise(r => setTimeout(r, 10));
    await request.patch(`/api/kanban/cards/${c.id}`).set(AS_ADMIN()).send({ done: true });

    expect(await orderOf(board.id)).toEqual([b.id, c.id, a.id]);
  });
});

describe('순서 바꾸기 — 전체 순서를 통째로 보낸다', () => {
  it('보낸 순서대로 자리가 잡힌다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    const c = await makeItem(board.id, { title: 'C' });

    const res = await request.patch(`/api/kanban/boards/${board.id}/reorder`).set(AS_ADMIN())
      .send({ ids: [c.id, a.id, b.id] });
    expect(res.status).toBe(200);
    expect(await orderOf(board.id)).toEqual([c.id, a.id, b.id]);
  });

  it('position 은 언제나 0..n-1 로 연속', async () => {
    const board = await makeBoard();
    const items: any[] = [];
    for (const t of ['A', 'B', 'C', 'D']) items.push(await makeItem(board.id, { title: t }));

    for (const order of [[3, 1, 0, 2], [2, 3, 1, 0], [0, 3, 2, 1]]) {
      await request.patch(`/api/kanban/boards/${board.id}/reorder`).set(AS_ADMIN())
        .send({ ids: order.map(i => items[i].id) });
      const rows = await testPrisma.kanbanCard.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } });
      expect(rows.map(r => r.position)).toEqual(rows.map((_, i) => i));
    }
  });

  it('빠뜨린 항목은 뒤에 붙는다 — 다른 Admin 이 그 사이 추가해도 실패하지 않는다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    const late = await makeItem(board.id, { title: '뒤늦게 추가됨' });

    // 화면이 A,B 만 알고 있던 상태에서 순서를 바꾼다
    const res = await request.patch(`/api/kanban/boards/${board.id}/reorder`).set(AS_ADMIN())
      .send({ ids: [b.id, a.id] });
    expect(res.status).toBe(200);
    expect(await orderOf(board.id)).toEqual([b.id, a.id, late.id]);
  });

  it('다른 보드의 항목은 섞이지 않는다', async () => {
    const b1 = await makeBoard('B1');
    const b2 = await makeBoard('B2');
    const mine = await makeItem(b1.id, { title: 'B1-1' });
    const other = await makeItem(b2.id, { title: 'B2-1' });

    await request.patch(`/api/kanban/boards/${b1.id}/reorder`).set(AS_ADMIN())
      .send({ ids: [other.id, mine.id] });

    const kept = await testPrisma.kanbanCard.findUnique({ where: { id: other.id } });
    expect(kept!.boardId).toBe(b2.id);
    expect(kept!.position).toBe(0);
    expect(await orderOf(b1.id)).toEqual([mine.id]);
  });

  it('빈 ids 는 아무것도 바꾸지 않는다', async () => {
    const board = await makeBoard();
    const a = await makeItem(board.id, { title: 'A' });
    const b = await makeItem(board.id, { title: 'B' });
    const res = await request.patch(`/api/kanban/boards/${board.id}/reorder`).set(AS_ADMIN()).send({ ids: [] });
    expect(res.body.moved).toBe(0);
    expect(await orderOf(board.id)).toEqual([a.id, b.id]);
  });

  it('없는 보드는 404', async () => {
    const res = await request.patch('/api/kanban/boards/9999/reorder').set(AS_ADMIN()).send({ ids: [1] });
    expect(res.status).toBe(404);
  });
});

describe('세부항목', () => {
  it('추가하면 맨 뒤에 붙고, 보드 상세에 함께 실려 온다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const a = await makeSub(item.id, '시안 3종 받기');
    const b = await makeSub(item.id, '대표 확인');
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(a.doneAt).toBeNull();

    const subs = await subsOf(board.id, item.id);
    expect(subs.map((s: any) => s.title)).toEqual(['시안 3종 받기', '대표 확인']);
  });

  it('세부항목이 없으면 빈 배열', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    expect(await subsOf(board.id, item.id)).toEqual([]);
  });

  it('제목이 비면 400', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const res = await request.post(`/api/kanban/cards/${item.id}/subtasks`).set(AS_ADMIN()).send({ title: '  ' });
    expect(res.status).toBe(400);
  });

  it('없는 항목에는 못 붙인다 (404)', async () => {
    const res = await request.post('/api/kanban/cards/9999/subtasks').set(AS_ADMIN()).send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  it('체크하면 doneAt 이 찍히고, 풀면 지워진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const sub = await makeSub(item.id, '업로드');

    const on = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ done: true });
    expect(on.body.doneAt).not.toBeNull();

    const off = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ done: false });
    expect(off.body.doneAt).toBeNull();
  });

  it('이미 체크된 걸 또 체크해도 시각이 안 바뀐다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const sub = await makeSub(item.id, '업로드');
    const first = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ done: true });
    const again = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ done: true });
    expect(again.body.doneAt).toBe(first.body.doneAt);
  });

  it('체크해도 자리가 안 바뀐다 — 서너 줄에서 줄이 튀면 다음 걸 누르기 힘들다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const a = await makeSub(item.id, 'A');
    const b = await makeSub(item.id, 'B');
    const c = await makeSub(item.id, 'C');

    await request.patch(`/api/kanban/subtasks/${a.id}`).set(AS_ADMIN()).send({ done: true });
    expect((await subsOf(board.id, item.id)).map((s: any) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('세부항목을 다 체크해도 상위 항목은 자동 완료되지 않는다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const a = await makeSub(item.id, 'A');
    const b = await makeSub(item.id, 'B');

    for (const s of [a, b]) {
      await request.patch(`/api/kanban/subtasks/${s.id}`).set(AS_ADMIN()).send({ done: true });
    }
    const parent = await testPrisma.kanbanCard.findUnique({ where: { id: item.id } });
    expect(parent!.doneAt).toBeNull();
  });

  it('이름을 고칠 수 있다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const sub = await makeSub(item.id, '오타');
    const res = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ title: '고침' });
    expect(res.body.title).toBe('고침');
  });

  it('이름을 빈 값으로 고치면 400', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const sub = await makeSub(item.id, 'A');
    const res = await request.patch(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN()).send({ title: ' ' });
    expect(res.status).toBe(400);
  });

  it('삭제하면 사라진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const sub = await makeSub(item.id, 'A');
    expect((await request.delete(`/api/kanban/subtasks/${sub.id}`).set(AS_ADMIN())).status).toBe(200);
    expect(await subsOf(board.id, item.id)).toEqual([]);
  });

  it('없는 세부항목은 404', async () => {
    expect((await request.patch('/api/kanban/subtasks/9999').set(AS_ADMIN()).send({ done: true })).status).toBe(404);
    expect((await request.delete('/api/kanban/subtasks/9999').set(AS_ADMIN())).status).toBe(404);
  });

  it('상위 항목을 지우면 세부항목도 함께 사라진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    await makeSub(item.id, 'A');
    await makeSub(item.id, 'B');
    await request.delete(`/api/kanban/cards/${item.id}`).set(AS_ADMIN());
    expect(await testPrisma.kanbanSubtask.count()).toBe(0);
  });

  it('보드를 지우면 세부항목도 함께 사라진다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    await makeSub(item.id, 'A');
    await request.delete(`/api/kanban/boards/${board.id}`).set(AS_ADMIN());
    expect(await testPrisma.kanbanSubtask.count()).toBe(0);
  });

  it('다른 항목의 세부항목과 섞이지 않는다', async () => {
    const board = await makeBoard();
    const one = await makeItem(board.id, { title: '하나' });
    const two = await makeItem(board.id, { title: '둘' });
    await makeSub(one.id, '하나-A');
    await makeSub(two.id, '둘-A');

    expect((await subsOf(board.id, one.id)).map((s: any) => s.title)).toEqual(['하나-A']);
    expect((await subsOf(board.id, two.id)).map((s: any) => s.title)).toEqual(['둘-A']);
  });
});

describe('댓글', () => {
  it('등록하면 작성자와 함께 온다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const res = await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN())
      .send({ body: '다음 회의에서 결정' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('다음 회의에서 결정');
    expect(res.body.author.id).toBe(4);
  });

  it('빈 댓글은 400', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const res = await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN()).send({ body: '  ' });
    expect(res.status).toBe(400);
  });

  it('오래된 것부터 정렬되고 항목의 댓글 수에 반영된다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    for (const b of ['첫째', '둘째', '셋째']) {
      await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN()).send({ body: b });
    }
    const list = await request.get(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN());
    expect(list.body.map((c: any) => c.body)).toEqual(['첫째', '둘째', '셋째']);

    const detail = await request.get(`/api/kanban/boards/${board.id}`).set(AS_ADMIN());
    expect(detail.body.cards[0]._count.comments).toBe(3);
  });

  it('남이 쓴 댓글은 지울 수 없다 — 회의 기록이 조용히 사라지면 안 된다', async () => {
    const other = await testPrisma.user.create({
      data: { id: 51, email: 'admin2@test.com', name: '관리자2', role: 'ADMIN' },
    });
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const created = await request.post(`/api/kanban/cards/${item.id}/comments`)
      .set('Authorization', `Bearer ${authToken(other.id, 'ADMIN')}`).send({ body: '내 의견' });

    const res = await request.delete(`/api/kanban/comments/${created.body.id}`).set(AS_ADMIN());
    expect(res.status).toBe(403);
    expect(await testPrisma.kanbanComment.count()).toBe(1);
  });

  it('본인 댓글은 지울 수 있다', async () => {
    const board = await makeBoard();
    const item = await makeItem(board.id);
    const created = await request.post(`/api/kanban/cards/${item.id}/comments`).set(AS_ADMIN()).send({ body: '내 메모' });
    const res = await request.delete(`/api/kanban/comments/${created.body.id}`).set(AS_ADMIN());
    expect(res.status).toBe(200);
    expect(await testPrisma.kanbanComment.count()).toBe(0);
  });
});

describe('담당자 후보', () => {
  it('Admin 만 나온다', async () => {
    const res = await request.get('/api/kanban/members').set(AS_ADMIN());
    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => m.id)).toEqual([4]);
  });

  it('탈퇴한 Admin 은 빠진다', async () => {
    await testPrisma.user.create({
      data: { id: 52, email: 'left@test.com', name: '떠난 관리자', role: 'ADMIN', deletedAt: new Date() },
    });
    const res = await request.get('/api/kanban/members').set(AS_ADMIN());
    expect(res.body.map((m: any) => m.id)).toEqual([4]);
  });
});
