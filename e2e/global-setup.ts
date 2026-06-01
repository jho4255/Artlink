import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

const API = 'http://localhost:4000/api';
const FE_ORIGIN = 'http://localhost:5173';
const AUTH_DIR = path.resolve(process.cwd(), '.auth');
const BACKEND = path.resolve(process.cwd(), '../backend');

// dev-login 제거(카카오 OAuth 전환) 이후: E2E는 백엔드와 동일한 JWT_SECRET으로 토큰을 직접 서명해 세션 주입.
function readJwtSecret(): string {
  try {
    const env = fs.readFileSync(path.join(BACKEND, '.env'), 'utf-8');
    const m = env.match(/^JWT_SECRET=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return 'artlink-dev-secret';
}

// 시드 리셋 후 유저 id는 항상 1~4 (seed.ts 생성 순서, autoincrement 초기화)
const SEED_USERS = [
  { role: 'artist',  id: 1, name: 'Artist 1',      email: 'artist1@artlink.com', userRole: 'ARTIST' },
  { role: 'artist2', id: 2, name: 'Artist 2',      email: 'artist2@artlink.com', userRole: 'ARTIST' },
  { role: 'gallery', id: 3, name: 'Gallery Owner', email: 'gallery@artlink.com', userRole: 'GALLERY' },
  { role: 'admin',   id: 4, name: 'Admin',         email: 'admin@artlink.com',   userRole: 'ADMIN' },
];

async function waitForBackend(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${API}/galleries`); if (r.ok) return; } catch {}
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error('백엔드(:4000)가 응답하지 않습니다. 서버를 먼저 켜주세요.');
}

export default async function globalSetup() {
  console.log('\n[global-setup] 1) DB 시드 리셋…');
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', { cwd: BACKEND, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { cwd: BACKEND, stdio: 'inherit' });

  console.log('[global-setup] 2) 백엔드 응답 대기…');
  await waitForBackend();

  console.log('[global-setup] 3) 역할별 세션(JWT 직접 서명) 생성…');
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const SECRET = readJwtSecret();
  const ids: Record<string, number> = {};
  const tokens: Record<string, string> = {};
  for (const u of SEED_USERS) {
    const token = jwt.sign({ userId: u.id, role: u.userRole }, SECRET, { expiresIn: '7d' });
    const user = { id: u.id, name: u.name, email: u.email, role: u.userRole };
    const storage = {
      cookies: [],
      origins: [{
        origin: FE_ORIGIN,
        localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) }],
      }],
    };
    fs.writeFileSync(path.join(AUTH_DIR, `${u.role}.json`), JSON.stringify(storage, null, 2));
    ids[u.role] = u.id;
    tokens[u.role] = token;
  }
  fs.writeFileSync(path.join(AUTH_DIR, 'ids.json'), JSON.stringify(ids, null, 2));
  fs.writeFileSync(path.join(AUTH_DIR, 'tokens.json'), JSON.stringify(tokens, null, 2));
  console.log('[global-setup] 완료. 유저 id:', ids, '\n');
}
