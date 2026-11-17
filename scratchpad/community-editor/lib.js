/**
 * 커뮤니티 글쓰기 점검 공용 — 세션 만들기·브라우저 열기. ⚠️ 로컬 전용(데모 DB 또는 실서버 복제본). 비밀값은 출력하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const jwt = require(path.resolve(__dirname, '../../backend/node_modules/jsonwebtoken'));
const { chromium, webkit, devices } = require(path.resolve(__dirname, '../../e2e/node_modules/playwright'));

const BASE = process.env.BASE || 'http://localhost:5173';
const API = process.env.API || 'http://localhost:4000/api';
const WEBKIT_RUN = path.join(process.env.HOME, '.cache/wk-deps/run.sh');

function jwtSecret() {
  const m = fs.readFileSync(path.resolve(__dirname, '../../backend/.env'), 'utf8').match(/^JWT_SECRET=(.*)$/m);
  if (!m) throw new Error('JWT_SECRET 없음');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function session(user) {
  const token = jwt.sign({ userId: user.id, role: user.role }, jwtSecret(), { expiresIn: '7d' });
  return {
    token,
    storage: {
      cookies: [],
      origins: [{
        origin: BASE,
        localStorage: [
          { name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) },
          { name: 'artlink-homepage-nudge-snooze', value: JSON.stringify({ [user.id]: 8.64e15 }) },
          { name: 'artlink-intro-hidden', value: JSON.stringify({ [user.id]: true }) },
        ],
      }],
    },
  };
}

async function launch(engine = 'chromium') {
  if (engine === 'webkit') {
    const opts = fs.existsSync(WEBKIT_RUN) ? { executablePath: WEBKIT_RUN } : {};
    return webkit.launch(opts);
  }
  return chromium.launch();
}

async function api(method, url, token, body) {
  const r = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}

module.exports = { BASE, API, session, launch, api, devices, path, fs };
