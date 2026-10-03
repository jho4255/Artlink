// P1. 흐름의 정합성 확인 — 데모 DB 전용(끝나면 백업으로 되돌린다)
const L = require('./lib.js');
const fs = require('fs'); const path = require('path');
const TERMS = fs.readFileSync(path.resolve(__dirname, '../../backend/src/lib/terms.ts'), 'utf8').match(/ARTIST_APPLY_TERMS_VERSION\s*=\s*['"]([^'"]+)['"]/)[1];
const say = (k, ...v) => console.log(`${k}:`, ...v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
(async () => {
  console.log('\n=== A. 전시 종료를 되돌린 뒤 출품 목록을 고치면 판매 기록이 다른 작품에 붙는가 (단계 09 = id 13) ===');
  let s = await L.api('gallery', 'GET', '/operations/13/settlement');
  const before = s.body.artists.map((a) => ({ id: a.user.id, name: a.user.name, appr: a.approval && a.approval.status, works: a.works.map((w) => `${w.index}:${w.title}${w.sold ? `(판매 ${w.soldPrice})` : ''}`) }));
  say('되돌리기 전', before);
  const target = s.body.artists.find((a) => a.works.some((w) => w.sold) && a.works.length >= 2);
  let r = await L.api('gallery', 'PATCH', '/operations/13/lifecycle', { ended: false });
  say('PATCH lifecycle {ended:false}', r.status, r.body);
  if (r.status === 200 && target) {
    const edit = await L.api('gallery', 'GET', `/operations/13/submissions/${target.user.id}/edit`);
    const list = edit.body.artworkList;
    const reordered = [...list].reverse();   // 순서만 뒤집는다
    r = await L.api('gallery', 'PUT', `/operations/13/submissions/${target.user.id}`, { ...edit.body, artworkList: reordered, representativeIndex: edit.body.representativeIndex });
    say('종료 되돌린 상태에서 [대신 입력]으로 출품 목록 순서 변경', r.status);
    r = await L.api('gallery', 'PATCH', '/operations/13/lifecycle', { ended: true });
    say('다시 전시 종료', r.status);
    s = await L.api('gallery', 'GET', '/operations/13/settlement');
    const t2 = s.body.artists.find((a) => a.user.id === target.user.id);
    say('되돌린 뒤 같은 작가', { appr: t2.approval && t2.approval.status, works: t2.works.map((w) => `${w.index}:${w.title}${w.sold ? `(판매 ${w.soldPrice})` : ''}`) });
    say('→ 처음', target.works.map((w) => `${w.index}:${w.title}${w.sold ? `(판매 ${w.soldPrice})` : ''}`));
  }

  console.log('\n=== B. 공모만 진행 — 시작일이 마감일보다 늦어도 등록되는가 / 지난 마감일 ===');
  r = await L.api('gallery', 'POST', '/exhibitions', { title: '점검 B1 순서 뒤집힘', type: 'SOLO', deadlineStart: '2026-11-20', deadline: '2026-11-10', recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: 1 });
  say('recruitOnly start>deadline', r.status, r.body.id || r.body);
  r = await L.api('gallery', 'POST', '/exhibitions', { title: '점검 B2 지난 마감', type: 'SOLO', deadlineStart: '2026-09-01', deadline: '2026-09-10', recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: 1 });
  say('마감일이 이미 지난 공모 등록', r.status, r.body.id || r.body);
  r = await L.api('gallery', 'POST', '/exhibitions', { title: '점검 B3 전시 종료<시작', type: 'SOLO', deadlineStart: '2026-11-01', deadline: '2026-11-10', submissionDeadline: '2026-11-15', exhibitStartDate: '2026-11-30', exhibitDate: '2026-11-20', capacity: 1, region: 'SEOUL', description: 'x', galleryId: 1 });
  say('전시 종료일 < 시작일', r.status, r.body.id || r.body);
  r = await L.api('gallery', 'POST', '/exhibitions', { title: '점검 B4 정원 큰 수', type: 'SOLO', deadlineStart: '2026-11-01', deadline: '2026-11-10', recruitOnly: true, capacity: 99999999999, region: 'SEOUL', description: 'x', galleryId: 1 });
  say('capacity 99999999999', r.status, r.body.id || r.body);
  r = await L.api('gallery', 'POST', '/exhibitions', { title: 'T'.repeat(5000), type: 'SOLO', deadlineStart: '2026-11-01', deadline: '2026-11-10', recruitOnly: true, capacity: 1, region: '없는지역', description: 'x', galleryId: 1 });
  say('제목 5000자 · 없는 지역', r.status, typeof r.body.id === 'number' ? `등록됨 id ${r.body.id}` : r.body);

  console.log('\n=== C. 공모 시작일 전에 지원이 되는가 ===');
  r = await L.api('gallery', 'POST', '/exhibitions', { title: '점검 C 아직 시작 전', type: 'SOLO', deadlineStart: '2026-11-01', deadline: '2026-11-10', recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: 1 });
  const cId = r.body.id;
  await L.api('admin', 'PATCH', `/approvals/exhibition/${cId}`, { status: 'APPROVED' });
  const lst = await L.api(null, 'GET', '/exhibitions');
  say('목록에 보이나(시작 전)', lst.body.some((e) => e.id === cId));
  const det = await L.api(null, 'GET', `/exhibitions/${cId}`);
  say('상세는 열리나', det.status);
  r = await L.api('artist2', 'POST', `/exhibitions/${cId}/apply`, { biography: 'x', career: {}, artworkImages: ['/demo-art/a01.jpg'], termsAgreed: true, termsVersion: TERMS });
  say('시작일 전 지원', r.status, r.body.id ? '지원됨' : r.body);

  console.log('\n=== D. 정산 완료·전시 종료 뒤에도 지원 상태를 바꿀 수 있는가 ===');
  const apps15 = await L.api('gallery', 'GET', '/exhibitions/15/applications');
  say('단계 11(정산 완료) 지원자', apps15.body.map((a) => [a.id, a.user.name, a.status]));
  const apps12 = await L.api('gallery', 'GET', '/exhibitions/12/applications');
  say('단계 08(전시 종료) 지원자', apps12.body.map((a) => [a.id, a.user.name, a.status]));
  // 전시 종료 뒤 새 작가가 초대 코드/지원으로 들어올 수 있나 → 지원은 마감이라 막힘. 거절→수락 전환은?
  const rej = [...apps15.body, ...apps12.body].find((a) => a.status === 'REJECTED');
  say('거절된 지원 있음?', !!rej);

  console.log('\n=== E. 이상한 출품 자료 한 건이 갤러리 화면을 죽이는가 (단계 04 = id 8, Artist 1 수락) ===');
  const mine = await L.api('artist', 'GET', '/operations/8/me');
  r = await L.api('artist', 'PUT', '/operations/8/me', { artworkList: [{ title: 'a', draft: true }], cv: 'plain-string', note: { statement: 's', sections: 'not-an-array' }, representativeIndex: 0 });
  say('PUT /me 이상한 모양', r.status);
  r = await L.api('gallery', 'GET', '/operations/8/submissions');
  say('갤러리 GET submissions', r.status, r.status === 200 ? 'ok' : r.body);
  r = await L.api('artist', 'PUT', '/operations/8/me', { artworkList: [{ title: 5, image: { a: 1 }, price: [], size: null }, null, 'str'], cv: { solo: 'x', nameKo: 123 }, note: { statement: 42, sections: [{ title: null, body: 1 }] }, representativeIndex: 0 });
  say('PUT /me 타입이 다른 값', r.status);
  r = await L.api('gallery', 'GET', '/operations/8/submissions'); say('갤러리 GET submissions', r.status);
  r = await L.api('gallery', 'GET', '/operations/8/caption.hwp'); say('캡션 hwp', r.status, typeof r.body === 'string' ? `${r.body.length}B` : r.body);
  r = await L.api('gallery', 'GET', '/exhibitions/my-operation-overview'); say('내 공모 overview', r.status);
  r = await L.api('artist', 'GET', '/exhibitions/my-applications'); say('작가 my-applications', r.status);
  fs.writeFileSync(path.join(__dirname, 'out', 'e-restore.json'), JSON.stringify(mine.body));
})().catch((e) => { console.error(e); process.exit(1); });
