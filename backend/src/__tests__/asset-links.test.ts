/**
 * Android App Links 검증 파일 (2026-11-09, CLAUDE.md 규칙 79) — /.well-known/assetlinks.json
 */
import { describe, it, expect, afterEach } from 'vitest';
import { request } from './helpers';
import { parseCertFingerprints, assetLinksJson, ANDROID_PACKAGE } from '../lib/assetLinks';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FP1 = 'AB'.repeat(32);
const FP1_COLON = FP1.match(/.{2}/g)!.join(':');
const FP2_COLON = '0F:'.repeat(31) + '0F';

afterEach(() => { process.env.ANDROID_CERT_SHA256 = ''; });

describe('GET /.well-known/assetlinks.json', () => {
  it('지문을 안 넣었으면 404 — 엉터리 파일을 내보내면 검증이 실패로 굳는다', async () => {
    const res = await request.get('/.well-known/assetlinks.json');
    expect(res.status).toBe(404);
  });

  it('★ 넣었으면 JSON — 패키지·관계·정리된 지문(대문자·콜론), 틀린 항목은 버린다', async () => {
    process.env.ANDROID_CERT_SHA256 = `${FP1.toLowerCase()}, ${FP2_COLON} ,not-a-fingerprint`;
    const res = await request.get('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FP1_COLON, FP2_COLON] },
      },
    ]);
  });
});

describe('parseCertFingerprints · assetLinksJson', () => {
  it('중복·빈 값·길이가 틀린 값을 거른다', () => {
    expect(parseCertFingerprints(`${FP1},${FP1_COLON},`)).toEqual([FP1_COLON]);
    expect(parseCertFingerprints('AB:CD')).toEqual([]);
    expect(parseCertFingerprints(undefined)).toEqual([]);
    expect(assetLinksJson('')).toBeNull();
  });

  it('★ 패키지 이름이 앱(mobile/)과 같다 — 다르면 검증이 조용히 실패한다', () => {
    const gradle = readFileSync(join(__dirname, '../../../mobile/android/app/build.gradle'), 'utf8');
    expect(gradle).toContain(`applicationId "${ANDROID_PACKAGE}"`);
  });
});
