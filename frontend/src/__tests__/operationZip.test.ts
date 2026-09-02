/**
 * 전체 다운로드 ZIP의 구조 — 누락 메모 + 작가별 폴더.
 *
 * ## 누락 메모 — ZIP이 스스로 "무엇이 빠졌는지" 증언하게 하는 마지막 안전망.
 *
 * 화면 안내(토스트·배너)는 페이지를 닫으면 사라진다. 작품이 하나 빠졌는데 안내마저 사라지면
 * 사용자는 빠진 사실 자체를 모른 채 넘어간다("하나 빠지면 어떡해", 2026-08 지적).
 * 그래서 자동 회수까지 하고도 못 받은 게 있으면 ZIP 안에 목록 파일을 넣는다.
 */
import { describe, it, expect } from 'vitest';
import { missingNote, MISSING_NOTE_NAME, artistFolderNames } from '../lib/operationPdf';

describe('missingNote', () => {
  const items = ['한도윤 · 무제 3', '이서준 · 봄의 기록'];

  it('파일명이 목록 맨 위에 오도록 밑줄로 시작한다', () => {
    expect(MISSING_NOTE_NAME.startsWith('_')).toBe(true);
    expect(MISSING_NOTE_NAME.endsWith('.txt')).toBe(true);
  });

  it('공모명·건수·항목이 모두 담긴다', () => {
    const note = missingNote('2026 봄 공모', '작품 원본 이미지', items);
    expect(note).toContain('2026 봄 공모');
    expect(note).toContain('작품 원본 이미지');
    expect(note).toContain('2건');
    expect(note).toContain('1. 한도윤 · 무제 3');
    expect(note).toContain('2. 이서준 · 봄의 기록');
  });

  it('★ 목록을 자르지 않는다 — 화면은 3건만 보여줘도 파일에는 전부 있어야 한다', () => {
    const many = Array.from({ length: 40 }, (_, i) => `작가${i} · 작품${i}`);
    const note = missingNote('공모', '작품 원본', many);
    expect(note).toContain('40. 작가39 · 작품39');
    expect(note.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(40);
  });

  it('이 항목들이 ZIP에 없다는 사실과 복구 방법을 알려준다', () => {
    const note = missingNote('공모', '작품 원본', items);
    expect(note).toContain('들어있지 않습니다');
    expect(note).toContain('다시 받기');
  });
});

/**
 * 작가별 폴더 — 전체 다운로드 ZIP은 작가명 폴더로 나눈다.
 *
 * ⚠️ 동명이인이 핵심. 같은 이름 두 명을 한 폴더에 합치면 갤러리가 서로 다른 작가의 작품을
 * 섞어버린다. 파일이 사라지지 않으니 눈치채기도 어렵다 — 반드시 분리해야 한다.
 */
describe('artistFolderNames', () => {
  it('작가마다 폴더 하나', () => {
    const m = artistFolderNames([
      { id: 1, name: '한도윤' },
      { id: 2, name: '이서준' },
    ]);
    expect(m.get(1)).toBe('한도윤');
    expect(m.get(2)).toBe('이서준');
  });

  it('닉네임이 있으면 함께 표기한다 (화면 표기와 일치)', () => {
    const m = artistFolderNames([{ id: 1, name: '한도윤', nickname: '혜원' }]);
    expect(m.get(1)).toContain('한도윤');
    expect(m.get(1)).toContain('혜원');
  });

  it('★ 동명이인은 다른 폴더로 분리한다 (작품이 섞이면 안 된다)', () => {
    const m = artistFolderNames([
      { id: 1, name: '김민수' },
      { id: 2, name: '김민수' },
      { id: 3, name: '김민수' },
    ]);
    expect(m.get(1)).toBe('김민수');
    expect(m.get(2)).toBe('김민수 (2)');
    expect(m.get(3)).toBe('김민수 (3)');
    expect(new Set([m.get(1), m.get(2), m.get(3)]).size, '셋 다 달라야 한다').toBe(3);
  });

  it('같은 작가가 여러 번 들어와도 폴더는 하나 (중복 호출 방어)', () => {
    const u = { id: 1, name: '한도윤' };
    const m = artistFolderNames([u, u, u]);
    expect(m.size).toBe(1);
    expect(m.get(1)).toBe('한도윤');
  });

  it('★ 경로 구분자는 제거된다 (ZIP 밖으로 새어나가면 안 된다)', () => {
    const m = artistFolderNames([{ id: 1, name: '../../etc/passwd' }]);
    expect(m.get(1)).not.toContain('/');
    expect(m.get(1)).not.toContain('\\');
  });

  it('이름이 비어도 폴더명이 생긴다', () => {
    const m = artistFolderNames([{ id: 1, name: '' }]);
    expect(m.get(1)).toBeTruthy();
  });
});
