/**
 * 주소 검색 — 카카오(다음) 우편번호 서비스(2026-11-15, 갤러리 등록·정보 수정). 무료 · 키 없음 · 외부 스크립트 하나.
 *
 * ⚠️ 팝업(`.open()`)을 쓰지 말 것 — 안드로이드 앱(WebView)과 인앱 브라우저에서 새 창이 막히거나 앱 밖으로 나간다.
 *    우리 창 안에 끼워 넣는다(`.embed(element)`, components/form/AddressField.tsx).
 * ⚠️ 스크립트는 **누를 때** 받는다(첫 화면에 외부 스크립트를 얹지 않는다). 못 받으면 사람이 직접 친다 — 주소 칸은 늘 직접 입력도 된다.
 * 두 CDN(t1.daumcdn.net / t1.kakaocdn.net)이 같은 파일을 준다(2026-11-15 확인, VERSION 261109) — 전역 `kakao`·`daum` 둘 다 같은 것을 가리킨다.
 */
const SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
const TIMEOUT_MS = 10_000;

export interface PostcodeResult {
  address: string;
  roadAddress: string;
  jibunAddress: string;
  zonecode: string;
  buildingName: string;
  sido: string;
  sigungu: string;
  userSelectedType: 'R' | 'J';
}

interface PostcodeInstance { embed: (el: HTMLElement, opts?: { q?: string; autoClose?: boolean }) => void }
type PostcodeCtor = new (opts: {
  oncomplete: (data: PostcodeResult) => void;
  width?: string | number;
  height?: string | number;
}) => PostcodeInstance;

declare global {
  interface Window { kakao?: { Postcode?: PostcodeCtor }; daum?: { Postcode?: PostcodeCtor } }
}

let loading: Promise<PostcodeCtor> | null = null;

/** 스크립트를 한 번만 받는다. 실패하면 다음에 다시 시도할 수 있게 비운다 */
export function loadPostcode(): Promise<PostcodeCtor> {
  const ready = () => window.kakao?.Postcode ?? window.daum?.Postcode;
  const have = typeof window !== 'undefined' ? ready() : undefined;
  if (have) return Promise.resolve(have);
  if (loading) return loading;
  loading = new Promise<PostcodeCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    const timer = window.setTimeout(() => { loading = null; reject(new Error('timeout')); }, TIMEOUT_MS);
    s.onload = () => {
      window.clearTimeout(timer);
      const ctor = ready();
      if (ctor) resolve(ctor);
      else { loading = null; reject(new Error('no Postcode')); }
    };
    s.onerror = () => { window.clearTimeout(timer); loading = null; s.remove(); reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return loading;
}

/** 고른 주소 한 줄 — 도로명을 기본으로(지번을 골랐으면 지번) */
export function pickedAddress(r: PostcodeResult): string {
  const main = r.userSelectedType === 'J' ? r.jibunAddress : r.roadAddress;
  return (main || r.address || '').trim();
}
