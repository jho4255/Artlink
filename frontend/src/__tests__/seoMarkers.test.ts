/**
 * index.html의 SEO 마커 보호 테스트
 *
 * 백엔드(`backend/src/lib/seoMeta.ts`)는 상세 페이지 요청 시
 * `<!--SEO_META_START-->` ~ `<!--SEO_META_END-->` 사이를 교체해 공모/갤러리별
 * title·og 태그를 내려준다. 마커가 사라지면 주입이 조용히 비활성화되고
 * 카톡 공유 미리보기·검색 노출이 전부 기본값으로 되돌아가므로 여기서 잡는다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf-8');

describe('index.html SEO 마커', () => {
  it('시작/종료 마커가 각각 하나씩 존재한다', () => {
    expect(html.split('<!--SEO_META_START-->').length - 1).toBe(1);
    expect(html.split('<!--SEO_META_END-->').length - 1).toBe(1);
  });

  it('마커 순서가 올바르다', () => {
    expect(html.indexOf('<!--SEO_META_START-->')).toBeLessThan(html.indexOf('<!--SEO_META_END-->'));
  });

  it('교체 대상 태그(title/description/og/twitter)가 마커 안에 있다', () => {
    const start = html.indexOf('<!--SEO_META_START-->');
    const end = html.indexOf('<!--SEO_META_END-->');
    const block = html.slice(start, end);
    for (const needle of [
      '<title>',
      'name="description"',
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'property="og:image"',
      'name="twitter:card"',
    ]) {
      expect(block).toContain(needle);
    }
  });

  it('도메인 인증 태그는 마커 밖에 있어 교체되지 않는다', () => {
    const end = html.indexOf('<!--SEO_META_END-->');
    expect(html.indexOf('facebook-domain-verification')).toBeGreaterThan(end);
  });
});
