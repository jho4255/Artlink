// P2. 권한 경계 확인 — 남의 공모·남의 자료에 손이 닿는가 (데모 DB 전용)
const L = require('./lib.js');
const say = (k, ...v) => console.log(`${k}:`, ...v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x).slice(0, 200))));
const raw = async (method, url, body, token) => {
  const r = await fetch(`${L.API}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j; const t = await r.text(); try { j = JSON.parse(t); } catch { j = t.slice(0, 80); }
  return { status: r.status, body: j };
};
(async () => {
  // 다른 갤러리 계정(남) · 일반 계정
  const mk = async (email, role) => {
    let r = await raw('POST', '/auth/signup', { name: `점검 ${role}`, email, password: 'probe-pass-1234', role, agreeTerms: true, agreePrivacy: true });
    if (r.status !== 201) r = await raw('POST', '/auth/login', { email, password: 'probe-pass-1234' });
    return r.body.token;
  };
  const other = await mk('probe.gallery@demo.artlink.local', 'GALLERY');
  const visitor = await mk('probe.visitor@demo.artlink.local', 'VISITOR');
  const artist2 = (await L.login('artist2')).token;       // 단계 공모들에 수락돼 있지 않은 작가일 수 있다
  const artist1 = (await L.login('artist')).token;
  const EX = 8;   // 단계 04 — 서울 현대 갤러리(gallery@) 소유, Artist 1 수락
  const apps = await L.api('gallery', 'GET', `/exhibitions/${EX}/applications`);
  const otherArtist = apps.body.find((a) => a.status === 'ACCEPTED' && a.user.id !== 1);
  const anyApp = apps.body[0];
  const routes = [
    ['GET', `/exhibitions/${EX}/applications`],
    ['PATCH', `/exhibitions/${EX}/applications/${anyApp.id}`, { status: 'REJECTED' }],
    ['GET', `/exhibitions/${EX}/join-code`],
    ['POST', `/exhibitions/${EX}/join-code`],
    ['GET', `/exhibitions/${EX}/invites`],
    ['POST', `/exhibitions/${EX}/invite`, { artistId: 2 }],
    ['PATCH', `/exhibitions/${EX}/description`, { description: 'hacked' }],
    ['PATCH', `/exhibitions/${EX}/custom-fields`, { customFields: [] }],
    ['PATCH', `/exhibitions/${EX}/submission-deadline`, { submissionDeadline: '2026-10-06' }],
    ['POST', `/exhibitions/${EX}/promo-photos`, { url: '/uploads/x.png' }],
    ['POST', `/exhibitions/${EX}/images`, { url: '/uploads/x.png' }],
    ['PATCH', `/exhibitions/${EX}/images/reorder`, { orderedIds: [] }],
    ['DELETE', `/exhibitions/${EX}`],
    ['GET', `/operations/${EX}/access`],
    ['GET', `/operations/${EX}/notices`],
    ['POST', `/operations/${EX}/notices`, { title: 't', content: 'c' }],
    ['GET', `/operations/${EX}/submissions`],
    ['GET', `/operations/${EX}/submissions/${otherArtist ? otherArtist.user.id : 7}`],
    ['GET', `/operations/${EX}/submissions/${otherArtist ? otherArtist.user.id : 7}/edit`],
    ['PUT', `/operations/${EX}/submissions/${otherArtist ? otherArtist.user.id : 7}`, { artworkList: [] }],
    ['POST', `/operations/${EX}/submission-reminders`, {}],
    ['GET', `/operations/${EX}/caption.hwp`],
    ['PATCH', `/operations/${EX}/lifecycle`, { recruitmentClosed: false }],
    ['GET', `/operations/${EX}/settlement`],
    ['PUT', `/operations/${EX}/settlement`, { sales: [], ratios: [] }],
    ['POST', `/operations/${EX}/settlement/request`],
    ['POST', `/operations/${EX}/settlement/complete`],
    ['GET', `/operations/${EX}/me`],
    ['PUT', `/operations/${EX}/me`, { artworkList: [] }],
    ['GET', `/operations/${EX}/my-settlement`],
    ['POST', `/operations/${EX}/settlement/respond`, { approve: true }],
    ['GET', '/exhibitions/my-exhibitions'],
    ['GET', '/exhibitions/hosted'],
    ['PATCH', `/approvals/exhibition/${EX}`, { status: 'APPROVED' }],
    ['GET', '/approvals'],
  ];
  const who = [['비로그인', null], ['다른 갤러리', other], ['일반', visitor], ['안 뽑힌 작가(artist2)', artist2], ['수락 작가(artist1)', artist1]];
  console.log('경로'.padEnd(52), who.map((w) => w[0]).join(' | '));
  for (const [m, u, b] of routes) {
    const row = [];
    for (const [, tok] of who) row.push((await raw(m, u, b, tok)).status);
    console.log(`${m} ${u}`.padEnd(52), row.join(' | '));
  }
  console.log('\n— 승인 전·반려 공모 상세(주소로 직접) —');
  for (const id of [5, 6]) say(`GET /exhibitions/${id}`, { 비로그인: (await raw('GET', `/exhibitions/${id}`)).status, 다른갤러리: (await raw('GET', `/exhibitions/${id}`, undefined, other)).status, 작가: (await raw('GET', `/exhibitions/${id}`, undefined, artist1)).status });
  console.log('\n— 공개 응답에 운영용 값이 섞여 있는가 —');
  const pub = await raw('GET', `/exhibitions/13`);
  say('공모 상세(비로그인) 키', Object.keys(pub.body));
  say('gallery 키', pub.body.gallery && Object.keys(pub.body.gallery));
  const lst = await raw('GET', `/exhibitions?scope=closed`);
  say('목록 항목 키', lst.body[0] && Object.keys(lst.body[0]));
  console.log('\n— 다른 갤러리가 남의 갤러리 이름으로 공모 등록 —');
  say('POST /exhibitions galleryId=1', await raw('POST', '/exhibitions', { title: 'x', type: 'SOLO', deadline: '2026-11-10', recruitOnly: true, capacity: 1, region: 'SEOUL', description: 'x', galleryId: 1 }, other));
  console.log('\n— 남의 지원·초대 —');
  say('acknowledge-rejection(남의 지원)', (await raw('POST', `/exhibitions/applications/${anyApp.id}/acknowledge-rejection`, {}, artist2)).status);
  say('작가가 지원자 상태 변경', (await raw('PATCH', `/exhibitions/${EX}/applications/${anyApp.id}`, { status: 'ACCEPTED' }, artist2)).status);
  console.log('\n— 지원서에 외부 주소 —');
  const TERMS = require('fs').readFileSync(require('path').resolve(__dirname, '../../backend/src/lib/terms.ts'), 'utf8').match(/ARTIST_APPLY_TERMS_VERSION\s*=\s*['"]([^'"]+)['"]/)[1];
  const r = await raw('POST', `/exhibitions/7/apply`, { biography: 'x', career: {}, artworkImages: ['https://tracker.example/pixel.png', '//tracker.example/p2.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA'], portfolioFileUrl: '//phish.example/login', termsAgreed: true, termsVersion: TERMS }, artist2);
  say('apply with external urls', r.status, r.status === 201 ? { images: r.body.artworkImages, file: r.body.portfolioFileUrl } : r.body);
})().catch((e) => { console.error(e); process.exit(1); });
