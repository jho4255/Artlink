import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const API = 'http://localhost:4000/api';
const FE_ORIGIN = 'http://localhost:5173';
const AUTH_DIR = path.resolve(process.cwd(), '.auth');
const BACKEND = path.resolve(process.cwd(), '../backend');

// 이메일 → 역할 키 (시드 리셋 후 id가 바뀌므로 이메일로 식별)
const ROLE_BY_EMAIL: Record<string, string> = {
  'artist1@artlink.com': 'artist',
  'artist2@artlink.com': 'artist2',
  'gallery@artlink.com': 'gallery',
  'admin@artlink.com': 'admin',
};

async function waitForBackend(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`${API}/galleries`); if (r.ok) return; } catch {}
    await new Promise(res => setTimeout(res, 1000));
  }
  throw new Error('백엔드(:4000)가 응답하지 않습니다. 서버를 먼저 켜주세요.');
}

export default async function globalSetup() {
  console.log('\n[global-setup] 1) DB 시드 리셋…');
  execSync('npx prisma migrate reset --force --skip-seed', { cwd: BACKEND, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { cwd: BACKEND, stdio: 'inherit' });

  console.log('[global-setup] 2) 백엔드 응답 대기…');
  await waitForBackend();

  console.log('[global-setup] 3) 역할별 로그인 세션(storageState) 생성…');
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const users: Array<{ id: number; email: string }> = await (await fetch(`${API}/auth/dev-users`)).json();

  const saved: Record<string, number> = {};
  for (const u of users) {
    const role = ROLE_BY_EMAIL[u.email];
    if (!role) continue;
    const res = await fetch(`${API}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: u.id }),
    });
    const { token, user } = await res.json();
    const storage = {
      cookies: [],
      origins: [{
        origin: FE_ORIGIN,
        localStorage: [{ name: 'artlink-auth', value: JSON.stringify({ state: { token, user, isAuthenticated: true }, version: 0 }) }],
      }],
    };
    fs.writeFileSync(path.join(AUTH_DIR, `${role}.json`), JSON.stringify(storage, null, 2));
    saved[role] = u.id;
  }
  // 테스트가 id를 알아야 할 때 쓰도록 매핑도 저장
  fs.writeFileSync(path.join(AUTH_DIR, 'ids.json'), JSON.stringify(saved, null, 2));
  console.log('[global-setup] 완료. 유저 id:', saved, '\n');
}
