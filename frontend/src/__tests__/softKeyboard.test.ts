/**
 * 자판이 떠 있는 동안 하단 탭바를 감춘다 (2026-11-14 앱 점검) — `hooks/useSoftKeyboard.ts`.
 * 안드로이드 앱(WebView)은 자판이 뜨면 화면이 줄어 하단 탭바가 자판 위로 따라 올라와 댓글·답글 칸 자리를 먹었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isTextEntry, keyboardLikelyOpen } from '@/hooks/useSoftKeyboard';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');

describe('isTextEntry — 자판이 뜨는 칸', () => {
  it('글 칸·입력칸·편집기는 그렇다', () => {
    const ta = document.createElement('textarea');
    const input = document.createElement('input');
    const email = Object.assign(document.createElement('input'), { type: 'email' });
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.append(div);
    expect(isTextEntry(ta)).toBe(true);
    expect(isTextEntry(input)).toBe(true);
    expect(isTextEntry(email)).toBe(true);
    // jsdom 은 contentEditable 을 isContentEditable 로 계산하지 않는다 — 브라우저처럼 흉내 낸다
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextEntry(div)).toBe(true);
    div.remove();
  });
  it('체크·단추·읽기 전용·꺼진 칸·없음은 아니다', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color']) {
      expect(isTextEntry(Object.assign(document.createElement('input'), { type })), type).toBe(false);
    }
    expect(isTextEntry(Object.assign(document.createElement('input'), { readOnly: true }))).toBe(false);
    expect(isTextEntry(Object.assign(document.createElement('textarea'), { disabled: true }))).toBe(false);
    expect(isTextEntry(document.createElement('button'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('keyboardLikelyOpen — 글자 칸에 있고 보이는 높이가 평소의 80% 아래', () => {
  it('앱(838 → 526)·브라우저(보이는 높이만 준다) 모두 자판으로 본다', () => {
    expect(keyboardLikelyOpen(true, 526, 838)).toBe(true);
    expect(keyboardLikelyOpen(true, 400, 844)).toBe(true);
  });
  it('글자 칸이 아니거나, 주소창이 접히는 정도(조금 줄어듦)는 자판이 아니다', () => {
    expect(keyboardLikelyOpen(false, 526, 838)).toBe(false);
    expect(keyboardLikelyOpen(true, 782, 838)).toBe(false);
    expect(keyboardLikelyOpen(true, 838, 838)).toBe(false);
    expect(keyboardLikelyOpen(true, 500, 0)).toBe(false);
  });
});

describe('소스 가드', () => {
  it('★ 하단 탭바는 자판이 떠 있으면 감춘다', () => {
    const bar = src('components/layout/BottomTabBar.tsx');
    expect(bar).toMatch(/const typing = useSoftKeyboardOpen\(\)/);
    expect(bar).toMatch(/hidden=\{typing \|\| undefined\}/);
  });
  it('★ 소식 올리기 — 꾸밈·크기·바탕색 단추는 글 칸의 포커스를 뺏지 않는다(자판이 내려가지 않게)', () => {
    const compose = src('pages/StoryComposePage.tsx');
    expect(compose).toMatch(/const keepFocus = \(e: React\.PointerEvent\) => e\.preventDefault\(\)/);
    expect(compose.match(/onPointerDown=\{keepFocus\}/g)?.length).toBe(3);
  });
});
