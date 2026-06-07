import { test, expect, request as pwRequest } from '@playwright/test';
import { tokenFor, applyToExhibition } from '../lib/helpers';

/**
 * 동시성: 정원 1명 공모에 여러 명이 "동시에" 지원하면 정원 초과 생성되는지(TOCTOU 경합).
 * KI-2 수정이 count-then-create 라 경합에 취약할 수 있어 검증.
 */
const API = 'http://localhost:4000/api';

test('정원 1명 공모에 동시 지원 6건 → 최종 수락/접수는 정원(1) 이하여야', async () => {
  const api = await pwRequest.newContext();
  const gTok = tokenFor('gallery');
  const adminTok = tokenFor('admin');

  // 정원 1 공모 생성 + 승인
  const gal = await (await api.get(`${API}/galleries?owned=true`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const galleryId = (gal.galleries || gal).find((g: any) => g.status === 'APPROVED').id;
  const ex = await (await api.post(`${API}/exhibitions`, {
    headers: { Authorization: `Bearer ${gTok}` },
    data: { title: '동시성테스트공모', type: 'SOLO', deadline: '2027-12-31', exhibitDate: '2028-01-31', capacity: 1, region: '서울', description: '동시성', galleryId },
  })).json();
  await api.patch(`${API}/approvals/exhibition/${ex.id}`, { headers: { Authorization: `Bearer ${adminTok}` }, data: { status: 'APPROVED' } });

  // 신규 작가 6명 생성(signup) → 토큰 확보
  const tokens: string[] = [];
  for (let i = 0; i < 6; i++) {
    const email = `race_${ex.id}_${i}@test.com`;
    const r = await api.post(`${API}/auth/signup`, { data: { name: `레이스${i}`, email, password: 'secret123', role: 'ARTIST' } });
    const body = await r.json();
    tokens.push(body.token);
  }

  // 6명 동시 지원 (Promise.all)
  const results = await Promise.all(tokens.map(t =>
    applyToExhibition(api, ex.id, t).then(res => res.status())
  ));
  const accepted = results.filter(s => s === 201).length;
  console.log('동시 지원 결과 상태들:', results.join(','), '→ 201 개수:', accepted);

  // 서버에 실제 저장된 지원 수 확인 (gallery 오너)
  const apps = await (await api.get(`${API}/exhibitions/${ex.id}/applications`, { headers: { Authorization: `Bearer ${gTok}` } })).json();
  const stored = (apps.applications || apps).length;
  await api.dispose();

  console.log('실제 저장된 지원 수:', stored, '(정원 1)');
  // 정원(1)을 넘는 지원이 저장되면 경합 버그
  expect(stored, '정원 초과 저장(TOCTOU 경합) 발생').toBeLessThanOrEqual(1);
});
