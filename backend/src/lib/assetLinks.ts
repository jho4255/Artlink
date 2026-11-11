/**
 * Android App Links 검증 파일 (2026-11-09, CLAUDE.md 규칙 79).
 *
 * 안드로이드는 앱(mobile/ — 매니페스트의 autoVerify intent-filter)을 설치할 때 https://artlink.cc/.well-known/assetlinks.json 을 받아
 * 이 사이트가 그 앱을 인정하는지 본다. 인정되면 카카오톡 등에서 누른 artlink.cc 링크가 앱으로 열린다.
 *
 * `ANDROID_CERT_SHA256` = 쉼표로 구분한 **서명 인증서 SHA-256 지문**(AA:BB:…). 디버그 키 · Play 앱 서명 키.
 * ⚠️ Play 앱 서명을 쓰면 넣을 값은 업로드 키가 아니라 **Play 콘솔의 '앱 서명 키' 지문**이다(사용자 폰의 앱은 구글이 다시 서명한다).
 * 값이 없거나 형식이 틀리면 null → 404. 엉터리 파일을 내보내면 그 설치에서 검증이 '실패'로 굳어 링크가 계속 브라우저로 간다.
 */
export const ANDROID_PACKAGE = 'cc.artlink.app';

const HEX64 = /^[0-9A-F]{64}$/;

/** 'aa:bb:…' · 'AABB…' 둘 다 받아 'AA:BB:…' 로. 형식이 틀린 항목은 버린다 */
export function parseCertFingerprints(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const hex = part.trim().replace(/:/g, '').toUpperCase();
    if (!HEX64.test(hex)) continue;
    const fp = hex.match(/.{2}/g)!.join(':');
    if (!out.includes(fp)) out.push(fp);
  }
  return out;
}

export function assetLinksJson(raw: string | undefined | null = process.env.ANDROID_CERT_SHA256) {
  const fingerprints = parseCertFingerprints(raw);
  if (!fingerprints.length) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
