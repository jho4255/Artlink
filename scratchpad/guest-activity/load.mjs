// 비회원 둘러보기 — 부하·용량 측정 (2026-10-03). 데모 백엔드(4001, 한도 꺼짐)·데모 DB 전용 — 실서버·복제본에 돌리지 말 것.
//   node scratchpad/guest-activity/load.mjs beacons [방문 수=600] [동시=50]   → 실제 화면처럼 방문마다 비콘 여러 번, 지연·실패·DB 증가량
//   node scratchpad/guest-activity/load.mjs stats [방문 수=20000]           → 큰 표에서 통계 요청 시간·서버 메모리
//   node scratchpad/guest-activity/load.mjs clean                           → 이 스크립트가 만든 줄(id 'load-' 로 시작) 지우기
// DB 는 반드시 DATABASE_URL 로 정해 준다(데모 DB) — 기본값을 두지 않는다(어느 DB 를 채우는지 늘 직접 고르게):
//   DATABASE_URL="$(cat <세션 스크래치>/demo-db-url)" node scratchpad/guest-activity/load.mjs beacons
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = process.env.API || 'http://localhost:4001/api';
const DB = process.env.DATABASE_URL;
if (!DB) { console.error('DATABASE_URL 로 데모 DB 를 정해 주세요'); process.exit(1); }
if (/artlink_prod|artlink_test|render\.com/.test(DB)) { console.error('실서버·복제본·테스트 DB 에는 돌리지 않는다'); process.exit(1); }
const sql = (q) => execFileSync('psql', [DB, '-tAc', q], { encoding: 'utf8' }).trim();
const PATHS = ['/', '/exhibitions', '/exhibitions/7', '/artists', '/@yunseo.kang', '/@yunseo.kang?work=31', '/@yunseo.kang?tab=cv', '/galleries', '/galleries/3', '/login', '/community', '/community/35'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pct = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;

/** 4001 에서 듣고 있는 node 의 RSS(MB) */
function backendRss() {
  try {
    const line = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' }).split('\n').find((l) => l.includes(':4001'));
    const pid = line?.match(/pid=(\d+)/)?.[1];
    if (!pid) return null;
    const m = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch { return null; }
}

async function beacons(visits = 600, conc = 50) {
  const before = { v: Number(sql(`SELECT count(*) FROM "GuestVisit"`)), p: Number(sql(`SELECT count(*) FROM "GuestPageView"`)) };
  // 방문마다: 화면 1~8개, 화면을 넘길 때마다 비콘 하나(직전 화면) + 첫 화면 미리 보내기 2번 + 떠날 때 하나 — 하니스 실측과 같은 꼴
  const jobs = [];
  for (let i = 0; i < visits; i++) {
    const id = `load-${Date.now().toString(36)}-${i.toString(36).padStart(6, '0')}x`;
    const n = 1 + Math.floor(Math.random() * 8);
    const views = Array.from({ length: n }, (_, s) => ({ seq: s, path: pick(PATHS), ms: 1000 + Math.floor(Math.random() * 40000) }));
    jobs.push({ visitId: id, views: [{ ...views[0], ms: 3000 }] });
    jobs.push({ visitId: id, views: [{ ...views[0], ms: 15000 }] });
    for (let s = 0; s < n; s++) jobs.push({ visitId: id, views: [views[s]], ...(s === n - 1 ? { left: true } : {}) });
  }
  const lat = []; let fail = 0; const codes = {};
  const t0 = Date.now();
  let next = 0;
  const rssBefore = backendRss();
  let rssPeak = rssBefore ?? 0;
  const rssTimer = setInterval(() => { const r = backendRss(); if (r && r > rssPeak) rssPeak = r; }, 200);
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const s = performance.now();
      try {
        const r = await fetch(`${API}/guest-activity`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(j) });
        codes[r.status] = (codes[r.status] || 0) + 1;
        if (r.status !== 204) fail++;
      } catch { fail++; codes.err = (codes.err || 0) + 1; }
      lat.push(performance.now() - s);
    }
  }));
  clearInterval(rssTimer);
  const secs = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const after = { v: Number(sql(`SELECT count(*) FROM "GuestVisit"`)), p: Number(sql(`SELECT count(*) FROM "GuestPageView"`)) };
  const bytes = Number(sql(`SELECT pg_total_relation_size('"GuestVisit"') + pg_total_relation_size('"GuestPageView"')`));
  const rows = after.v + after.p;
  console.log(JSON.stringify({
    방문: visits, 비콘: jobs.length, 동시: conc, 걸린초: +secs.toFixed(1), 초당: Math.round(jobs.length / secs),
    지연ms: { p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +lat[lat.length - 1].toFixed(1) },
    실패: fail, 응답: codes, 늘어난줄: { 방문: after.v - before.v, 화면: after.p - before.p },
    표크기: `${(bytes / 1024 / 1024).toFixed(1)}MB (${rows}줄 · 줄당 ${Math.round(bytes / Math.max(1, rows))}B)`,
    서버RSS_MB: { 전: rssBefore, 최고: rssPeak },
    방문당비콘: +(jobs.length / visits).toFixed(2),
  }, null, 1));
}

async function stats(visits = 20000) {
  // 표에 바로 넣는다(SQL) — 방문 N개 × 화면 평균 6개, 최근 30일에 고르게
  sql(`INSERT INTO "GuestVisit"(id, "startedAt", "lastSeenAt", outcome, "leftAt")
       SELECT 'load-s-' || g, now() - (random() * interval '29 days'), now() - (random() * interval '29 days'),
              CASE WHEN random() < 0.02 THEN 'SIGNUP' WHEN random() < 0.05 THEN 'LOGIN' END, now()
       FROM generate_series(1, ${visits}) g`);
  sql(`INSERT INTO "GuestPageView"("visitId", seq, path, "durationMs")
       SELECT 'load-s-' || g, s, (ARRAY['/','/exhibitions','/exhibitions/7','/artists','/@yunseo.kang','/@yunseo.kang?work=31','/galleries/3','/login','/community/35'])[1 + floor(random()*9)::int], floor(random()*60000)::int
       FROM generate_series(1, ${visits}) g, generate_series(0, 5) s`);
  const login = await fetch(`${API}/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@artlink.com' }) }).then((r) => r.json());
  const rssBefore = backendRss();
  let rssPeak = rssBefore ?? 0;
  const rssTimer = setInterval(() => { const r = backendRss(); if (r && r > rssPeak) rssPeak = r; }, 100);
  const times = [];
  let capped = null; let counted = null;
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    const r = await fetch(`${API}/admin/stats/guests?days=90`, { headers: { Authorization: `Bearer ${login.token}` } });
    const body = await r.json();
    times.push(performance.now() - s);
    capped = body.capped; counted = body.summary?.visits;
  }
  clearInterval(rssTimer);
  const bytes = Number(sql(`SELECT pg_total_relation_size('"GuestVisit"') + pg_total_relation_size('"GuestPageView"')`));
  console.log(JSON.stringify({
    넣은방문: visits, 넣은화면: visits * 6, 통계ms: times.map((t) => Math.round(t)), capped, 센방문: counted,
    서버RSS_MB: { 전: rssBefore, 최고: rssPeak }, 표크기MB: +(bytes / 1024 / 1024).toFixed(1),
  }, null, 1));
}

function clean() {
  const v = sql(`WITH d AS (DELETE FROM "GuestVisit" WHERE id LIKE 'load-%' RETURNING 1) SELECT count(*) FROM d`);
  console.log(`지운 방문 ${v}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'beacons') await beacons(Number(a) || 600, Number(b) || 50);
else if (cmd === 'stats') await stats(Number(a) || 20000);
else if (cmd === 'clean') clean();
else console.log('beacons | stats | clean');
