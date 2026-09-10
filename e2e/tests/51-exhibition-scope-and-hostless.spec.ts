import { test, expect, request as pwRequest } from '@playwright/test';
import { openAs, tokenFor, exhibitionDates, createExhibition, ownedGalleryId, settle } from '../lib/helpers';

/**
 * 공모 두 가지 새 규칙 (2026-09-10)
 *
 *   ① 아트링크(Admin) 주최 공모는 **갤러리를 안 끼고** 열 수 있다.
 *   ② 공고마다 **전시까지 진행 / 공모만 진행**을 고른다. 공모만 진행하면 수락이 끝이다.
 *
 * ⚠️ 여기서 보는 것은 "칸이 보이는가" 가 아니라 **눌러서 무슨 일이 나는가** 다.
 *    이 저장소에서 반복된 실패가 정확히 그 틈이었다 — 화면은 멀쩡한데 없는 API 를 부르거나,
 *    폼이 서버가 안 읽는 이름으로 값을 보내서 **에러 없이 조용히** 어긋났다(CLAUDE.md 32번).
 *    그래서 폼으로 만들고 → DB/API 응답으로 확인하고 → 뒷 단계가 실제로 막히는지까지 본다.
 */
const API = 'http://localhost:4000/api';

// ───────────────────────────────────────────── ① 갤러리 없는 아트링크 주최 공모
test.describe('아트링크가 갤러리를 안 끼고 여는 공모', () => {
  test('★ Admin 폼에서 운영 갤러리를 하나도 안 고르고 등록 → 공개 상세가 열린다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'admin');
    const title = `E2E 갤러리없는 주최공모 ${Date.now()}`;
    const d = exhibitionDates();

    // 폼이 실제로 보내는 payload 를 가로채 확인한다 — '보낸 척' 을 잡기 위해서
    const posted = page.waitForRequest(
      (r) => r.url().includes('/api/exhibitions/hosted') && r.method() === 'POST',
    );

    await page.goto('/mypage?tab=hosted-exhibitions');
    await page.getByRole('button', { name: '주최 공모 등록' }).click();

    // 운영 갤러리는 **비워 둔다** — 예전엔 여기서 "1곳 이상" 을 요구해 등록 자체가 막혔다
    await expect(page.getByText('아트링크(관리자)가 직접 운영', { exact: false })).toBeVisible();

    await page.getByPlaceholder('공모 제목').fill(title);
    await page.locator('input[type="date"]').nth(0).fill(d.deadlineStart);
    await page.locator('input[type="date"]').nth(1).fill(d.deadline);
    await page.locator('input[type="date"]').nth(2).fill(d.exhibitStartDate);
    await page.locator('input[type="date"]').nth(3).fill(d.exhibitDate);
    await page.locator('input[type="date"]').nth(4).fill(d.submissionDeadline);
    await page.getByPlaceholder('공모 소개').fill('운영 갤러리 없이 여는 기획 공모입니다.');

    await page.getByRole('button', { name: '등록', exact: true }).click();
    // ⚠️ 등록은 ConfirmDialog 를 한 번 더 거친다 — 폼 버튼만 누르면 아무 요청도 안 나간다
    await expect(page.getByText('이 내용으로 등록하시겠습니까?', { exact: false })).toBeVisible();
    // 확인 모달이 '갤러리 0곳' 을 제대로 말해 주는가 (예전 문구는 "선택한 갤러리 0곳이 운영 권한을 갖습니다" 였다)
    await expect(page.getByText('운영 갤러리를 지정하지 않았습니다', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '등록', exact: true }).last().click();

    const req = await posted;
    expect(req.postDataJSON().galleryIds).toEqual([]);

    // 서버에 실제로 갤러리 없이 저장됐는가
    const api = await pwRequest.newContext();
    const listed = await api.get(`${API}/exhibitions/hosted`, {
      headers: { Authorization: `Bearer ${tokenFor('admin')}` },
    });
    const mine = (await listed.json()).find((e: any) => e.title === title);
    expect(mine, '등록한 공모가 주최 목록에 없다').toBeTruthy();
    expect(mine.galleryId).toBeNull();
    expect(mine.managerGalleries).toEqual([]);

    // 공개 상세가 500 없이 열리고, 갤러리 자리에 대신 들어갈 문구가 있는가
    const detail = await api.get(`${API}/exhibitions/${mine.id}`);
    expect(detail.status()).toBe(200);
    expect((await detail.json()).gallery).toBeNull();
    await api.dispose();

    await page.goto(`/exhibitions/${mine.id}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10000 });
    // 갤러리명이 들어가던 자리에 이 문구가 대신 온다 (빈 '참여 갤러리 :' 로 남으면 데이터 누락처럼 보인다)
    await expect(page.getByText('아트링크가 직접 진행합니다.', { exact: true })).toBeVisible();
    await ctx.close();
  });
});

// ───────────────────────────────────────────── ② 공모만 진행
test.describe('공모만 진행하는 공고', () => {
  test('★ 갤러리 등록 폼에서 [공모만 진행] 을 고르면 자료제출 마감일 칸이 사라지고, 그대로 등록된다', async ({ browser }) => {
    const { page, ctx } = await openAs(browser, 'gallery');
    const title = `E2E 공모만진행 ${Date.now()}`;
    const d = exhibitionDates();

    await page.goto('/exhibitions/new');
    await settle(page, 800);

    // 기본값은 '전시까지 진행' — 그때는 자료제출 마감일이 필수 칸으로 보인다
    const subLabel = page.getByText('작가 자료제출 마감일', { exact: false });
    await expect(subLabel).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /공모만 진행/ }).click();
    // ⚠️ 비활성이 아니라 **없어져야** 한다 — 회색으로 남으면 "왜 못 쓰지" 를 묻게 된다
    await expect(subLabel).toBeHidden();

    const posted = page.waitForRequest(
      (r) => r.url().endsWith('/api/exhibitions') && r.method() === 'POST',
    );

    await page.locator('select').first().selectOption({ index: 1 });   // 갤러리 선택
    await page.getByPlaceholder('공모 제목').fill(title);
    await page.locator('input[type="date"]').nth(0).fill(d.deadlineStart);
    await page.locator('input[type="date"]').nth(1).fill(d.deadline);
    await page.locator('input[type="date"]').nth(2).fill(d.exhibitStartDate);
    await page.locator('input[type="date"]').nth(3).fill(d.exhibitDate);
    await page.getByPlaceholder('공모 소개').fill('지원자 선정까지만 진행합니다.');
    await page.getByRole('checkbox').last().check();                   // 약관 동의
    await page.getByRole('button', { name: '등록 요청', exact: true }).click();
    // ⚠️ 여기도 확인 모달을 거친다 (확인 버튼 라벨이 폼 버튼과 같아 `.last()` 로 모달 쪽을 집는다)
    await expect(page.getByText('이 내용으로 공모 등록을 요청하시겠습니까?')).toBeVisible();
    await page.getByRole('button', { name: '등록 요청', exact: true }).last().click();

    const req = await posted;
    const body = req.postDataJSON();
    expect(body.recruitOnly, '폼이 recruitOnly 를 안 보냈다').toBe(true);
    // 자료제출 마감일은 아예 안 보내거나 빈 값이어야 한다(없는 단계의 기한을 만들면 안 된다)
    expect(body.submissionDeadline || '').toBe('');

    await ctx.close();
  });

  test('★ 수락은 되고 그 뒤 단계는 서버가 막는다 (화면에서 감추는 것만으로는 부족하다)', async () => {
    const api = await pwRequest.newContext();
    const galleryId = await ownedGalleryId(api);
    const exId = await createExhibition(api, {
      title: `E2E 공모만진행 API ${Date.now()}`,
      galleryId,
      dates: { submissionDeadline: undefined },
      extra: { recruitOnly: true },
    });

    const gh = { Authorization: `Bearer ${tokenFor('gallery')}` };

    // 되는 것 — 모집마감·공지
    const closed = await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gh, data: { recruitmentClosed: true } });
    expect(closed.status()).toBe(200);
    const notice = await api.post(`${API}/operations/${exId}/notices`, { headers: gh, data: { title: '안내', content: '선정 결과를 안내드립니다.' } });
    expect(notice.status()).toBe(201);

    // 막히는 것 — 자료제출·정산·전시 확정
    for (const [label, res] of [
      ['제출 현황', await api.get(`${API}/operations/${exId}/submissions`, { headers: gh })],
      ['정산 조회', await api.get(`${API}/operations/${exId}/settlement`, { headers: gh })],
      ['전시 확정', await api.patch(`${API}/operations/${exId}/lifecycle`, { headers: gh, data: { confirmed: true } })],
    ] as const) {
      expect(res.status(), `${label} 이(가) 막히지 않았다`).toBe(400);
      expect((await res.json()).error).toContain('공모만 진행');
    }

    // 상세 페이지 응답에 진행 범위가 실려 내려오는가 (화면이 안내를 그리는 근거)
    const detail = await api.get(`${API}/exhibitions/${exId}`);
    expect((await detail.json()).recruitOnly).toBe(true);
    await api.dispose();
  });

  test('전시까지 진행하는 공모는 종전 그대로다 (회귀)', async () => {
    const api = await pwRequest.newContext();
    const galleryId = await ownedGalleryId(api);
    const exId = await createExhibition(api, { title: `E2E 전시까지 ${Date.now()}`, galleryId });
    const gh = { Authorization: `Bearer ${tokenFor('gallery')}` };

    expect((await api.get(`${API}/operations/${exId}/submissions`, { headers: gh })).status()).toBe(200);
    expect((await api.get(`${API}/operations/${exId}/settlement`, { headers: gh })).status()).toBe(200);
    expect((await api.get(`${API}/exhibitions/${exId}`)).json().then((b: any) => b.recruitOnly)).resolves.toBe(false);
    await api.dispose();
  });
});
