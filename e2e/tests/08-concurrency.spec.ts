import { test, expect, request as pwRequest } from '@playwright/test';
import { tokenFor, applyToExhibition, exhibitionDates } from '../lib/helpers';

/**
 * 동시성: 정원 1명 공모에서 여러 지원을 "동시에" 수락하면 정원을 넘겨 선정되는지(TOCTOU 경합).
 * 2026-09-27 부터 정원은 '선정 인원'이라 지원은 전부 받고, 수락이 한 트랜잭션에서 세고 바꾼다(lib/inviteCode.ts withSeatLock).
 */
const API = 'http://localhost:4000/api';

test('정원 1명 공모에 지원 6건을 동시에 수락 → 선정은 정원(1)을 넘지 않는다', async () => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const adminTok = tokenFor('admin');

  // 정원 1 공모 생성 + 승인
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '동시성테스트공모', type: 'SOLO', deadline: '2027-12-31', exhibitDate: '2028-01-31', capacity: 1, region: '서울', description: '동시성', galleryId, ...exhibitionDates() },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });

  // 신규 작가 6명 생성(signup) → 토큰 확보
  const tokens: string[] = [];
  for (let i = 0; i < 6; i++) {
    const email = `race_${ex.id}_${i}@test.com`;
    // ⚠️ 2026-09-04 부터 약관 동의가 **필수**다 — 빼면 400 이 나고 `body.token` 이 undefined 라
    //    아래 동시 지원이 전부 401 이 된다(정원 초과 회귀 테스트가 아무것도 안 재게 된다).
    const r = await api.post(`${API}/auth/signup`, { data: { name: `레이스${i}`, email, password: 'secret123', role: 'ARTIST', agreeTerms: true, agreePrivacy: true } });
    const body = await r.json();
    tokens.push(body.token);
  }

  // 6명 동시 지원 — 정원은 선정 인원이라 전부 받는다
  const results = await Promise.all(tokens.map(t =>
    applyToExhibition(api, ex.id, t).then(async res => ({ status: res.status(), id: res.ok() ? (await res.json()).id : null }))
  ));
  console.log('동시 지원 결과 상태들:', results.map(r => r.status).join(','));
  expect(results.every(r => r.status === 201), '지원은 정원과 무관하게 받아야 함').toBe(true);

  // 6건을 동시에 수락(일괄 수락과 같은 모양) → 정원 1 만 성공
  const accepts = await Promise.all(results.map(r =>
    api.patch(`${API}/exhibitions/${ex.id}/applications/${r.id}`, { headers: { Authorization: `Bearer ${gTok}` }, data: { status: 'ACCEPTED' } }).then(x => x.status())
  ));
  console.log('동시 수락 결과 상태들:', accepts.join(','));

  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const selected = (apps.applications || apps).filter((a: any) => a.status === 'ACCEPTED').length;
  await api.dispose();

  console.log('실제 선정 수:', selected, '(정원 1)');
  expect(selected, '정원 초과 선정(TOCTOU 경합) 발생').toBe(1);
  expect(accepts.filter(s => s === 200)).toHaveLength(1);
});
