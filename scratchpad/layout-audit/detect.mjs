/** 화면 점검 판정(walk.mjs · clicks.mjs 공용) — page.evaluate(DETECT) 로 부른다 */
// 페이지 안에서 도는 판정 — 던지지 않는다
export const DETECT = () => {
  const vw = document.documentElement.clientWidth;
  const res = { page: document.documentElement.scrollWidth - vw, clip: [], spill: [], offscreen: [] };
  const desc = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    const txt = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
  };
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inHScroll = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  const ellipsisAt = (el, stop) => { for (let p = el; p && p !== stop?.parentElement; p = p.parentElement) if (getComputedStyle(p).textOverflow === 'ellipsis') return true; return false; };
  const srOnly = (el) => { const r = el.getBoundingClientRect(); return r.width <= 2 && r.height <= 2; };
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('[aria-hidden="true"], [data-audit-skip]'));
  for (const el of all) {
    if (!visible(el) || srOnly(el)) continue;
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    // ② 잘림 — overflow hidden/clip 상자에서 넘친 것
    if ((ox === 'hidden' || ox === 'clip') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 4 && cs.textOverflow !== 'ellipsis') {
      const box = el.getBoundingClientRect();
      let worst = null; let worstOver = 1;
      for (const k of el.querySelectorAll('*')) {
        if (!visible(k) || srOnly(k) || ellipsisAt(k, el)) continue;
        // 흐린 배경 사진(blur + scale) 은 가장자리가 비치지 않게 일부러 키운 것(SkeletonImage) — 잘림이 아니다
        const kcs = getComputedStyle(k);
        if (kcs.filter.includes('blur') || (kcs.transform !== 'none' && kcs.position === 'absolute')) continue;
        // 가로로 미는 줄(탭·칩) 안은 그 줄이 맡는다
        let scroller = false;
        for (let p = k.parentElement; p && p !== el; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { scroller = true; break; } }
        if (scroller) continue;
        const r = k.getBoundingClientRect();
        const over = Math.max(r.right - box.right, box.left - r.left);
        if (over > worstOver) { worstOver = over; worst = k; }
      }
      if (worst) res.clip.push({ box: desc(el), over: Math.round(worstOver), what: desc(worst), y: Math.round(worst.getBoundingClientRect().top + scrollY) });
    }
    // ③ 삐져나옴 — 자식 요소 없는 글자 상자가 제 폭보다 넓은 글자를 그린다
    // (클래스에 overflow-visible 을 **일부러** 적은 글자 — 그래프 축 날짜처럼 옆 빈칸으로 넘치게 한 것 — 은 뺀다)
    if (ox === 'visible' && !(el.getAttribute('class') || '').includes('overflow-visible') && el.children.length === 0 && (el.textContent || '').trim() && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.display !== 'inline') {
      if (!ellipsisAt(el, null) && !inHScroll(el)) res.spill.push({ what: desc(el), over: el.scrollWidth - el.clientWidth, y: Math.round(el.getBoundingClientRect().top + scrollY) });
    }
    // ④ 화면 밖 — 누를 수 있는 것
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && cs.position !== 'fixed') {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inHScroll(el)) {
        let hiddenByClip = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'hidden' || o === 'clip') { const pr = p.getBoundingClientRect(); if (r.left >= pr.right || r.right <= pr.left) hiddenByClip = true; break; } }
        if (!hiddenByClip) res.offscreen.push({ what: desc(el), right: Math.round(r.right), left: Math.round(r.left), y: Math.round(r.top + scrollY) });
      }
    }
  }
  return res;
};
