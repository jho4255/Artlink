/**
 * 누락 메모 — ZIP이 스스로 "무엇이 빠졌는지" 증언하게 하는 마지막 안전망.
 *
 * 화면 안내(토스트·배너)는 페이지를 닫으면 사라진다. 작품이 하나 빠졌는데 안내마저 사라지면
 * 사용자는 빠진 사실 자체를 모른 채 넘어간다("하나 빠지면 어떡해", 2026-08 지적).
 * 그래서 자동 회수까지 하고도 못 받은 게 있으면 ZIP 안에 목록 파일을 넣는다.
 */
import { describe, it, expect } from 'vitest';
import { missingNote, MISSING_NOTE_NAME } from '../lib/operationPdf';

describe('missingNote', () => {
  const items = ['김혜원 · 무제 3', '이서준 · 봄의 기록'];

  it('파일명이 목록 맨 위에 오도록 밑줄로 시작한다', () => {
    expect(MISSING_NOTE_NAME.startsWith('_')).toBe(true);
    expect(MISSING_NOTE_NAME.endsWith('.txt')).toBe(true);
  });

  it('공모명·건수·항목이 모두 담긴다', () => {
    const note = missingNote('2026 봄 공모', '작품 원본 이미지', items);
    expect(note).toContain('2026 봄 공모');
    expect(note).toContain('작품 원본 이미지');
    expect(note).toContain('2건');
    expect(note).toContain('1. 김혜원 · 무제 3');
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
