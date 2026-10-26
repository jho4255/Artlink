/**
 * ArtLook — FrameIt 비교 뒤 더한 것(2026-10-25, CLAUDE.md 규칙 75) — 원형 액자(작품의 원 맞추기) · 액자 종류별 묶음 · 박스·슬림·플로터 재질 채우기 ·
 * 매끈한 마감 정리 · 박물관 색 벽 · 벽 캡션 카드 · 리넨/스웨이드 매트 · 여러 점 걸기(크기 조절).
 *
 * ArtLook 은 번들 밖 정적 페이지라 소스와 파일로 고정한다(artlookScreen.test.ts 와 같은 방식). 배치 계산(groupLayout)은
 * 순수 함수라 소스에서 떼어 실제로 돌린다. 픽셀은 jsdom 이 못 그린다 — 렌더는 e2e `75-artlook-frameit-adds` 와 하니스가 본다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUB = resolve(__dirname, '../../public/artlook');
const read = (p: string) => readFileSync(resolve(PUB, p), 'utf-8');
const html = read('index.html');
const ui = read('ui.js');
const scene = read('scene.js');

/** 소스에서 함수 하나를 떼어 낸다(중괄호 짝으로) */
function fnSource(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  expect(i, name).toBeGreaterThanOrEqual(0);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}

describe('원형 액자 — 사용자가 고른다(둥근 작품도 사진은 사각)', () => {
  it('FRAMES 맨 뒤에 블랙·골드 원형 — 앞 항목 번호를 하니스가 쓴다', () => {
    const ids = [...html.matchAll(/\{ id:'([a-z-]+)', name:'/g)].map((m) => m[1]);
    expect(ids.indexOf('canvas-wrap')).toBe(20);
    expect(ids).toContain('round-black');
    expect(ids).toContain('round-gold');
    expect(html).toMatch(/\{ id:'round-black', name:'블랙 원형',\s+kind:'round',\s+finish:'black'/);
  });

  it('작품은 그 원(o.circle — 없으면 사진 가운데 짧은 변 지름)을 정사각으로 떼어 원에 — 늘리지 않는다(규칙 18)', () => {
    const f = fnSource(html, 'buildRoundFramed');
    expect(f).toMatch(/const cir=clampCircle\(o\.circle, aw, ah\), S=2\*cir\.r\*Math\.min\(aw,ah\);/);
    expect(f).toMatch(/ctx\.drawImage\(img,cir\.cx\*aw-S\/2,cir\.cy\*ah-S\/2,S,S,cc-Rart,cc-Rart,2\*Rart,2\*Rart\)/);
    expect(f).toMatch(/c\._roundArtPx=S;/);
    expect(html).toMatch(/if\(style\.kind==='round'\) return buildRoundFramed\(img, style, o, matFrac\);/);
  });

  it('원은 사진 안에만 — 밖으로 나가면 테 안에 벽이 비친다(clampCircle 을 실제로 돌린다)', () => {
    const clamp = new Function(`${fnSource(html, 'clampCircle')}; return clampCircle;`)() as
      (c: unknown, w: number, h: number) => { cx: number; cy: number; r: number };
    expect(clamp(null, 900, 600)).toEqual({ cx: 0.5, cy: 0.5, r: 0.5 });                // 없으면 사진 가운데·짧은 변 지름
    const c = clamp({ cx: 0.9, cy: 0.5, r: 0.5 }, 900, 600);                               // 오른쪽 끝에 큰 원 → 줄어든다
    expect(c.r * 600).toBeLessThanOrEqual((1 - 0.9) * 900 + 1e-9);
    expect(clamp({ cx: 0.5, cy: 0.5, r: 0.001 }, 900, 600).r).toBe(0.05);               // 너무 작으면 하한
  });

  it('작품의 원을 사진에서 찾는다 — 그림자는 흐릿하고 가장자리는 또렷하다(방향마다 가장 크게 바뀌는 곳 → 원 맞춤)', () => {
    const f = fnSource(html, 'detectArtCircle');
    expect(f).toMatch(/if\(spread>60\) return null;/);                                   // 가장자리가 어수선하면 찾지 않는다
    expect(f).toMatch(/if\(bw\/bh>1\.18 \|\| bh\/bw>1\.18\) return null;/);           // 정사각에 가까워야 원
    expect(f).toMatch(/for\(let a=0;a<72;a\+\+\)/);                                    // 72 방향 경계
    expect(f).toMatch(/r:f\[2\]\*0\.99\/Math\.min\(w,h\)/);                          // 1% 안쪽(배경이 실처럼 비치지 않게)
  });

  it('화면 — 그리기 직전에 작품마다 원을 붙이고(기억 > 자동), [원 맞추기] 창에서 맞춘 원은 이 브라우저에 작품별로', () => {
    expect(ui).toMatch(/const CIRCLE_KEY='artlook:circles';/);
    expect(ui).toMatch(/if\(savedCircles\[w\.url\]\) return savedCircles\[w\.url\];/);
    expect(ui).toMatch(/applyCircles\(\);\n {2}compose\(\);/);
    // [원 맞추기]는 원형 칩 바로 옆 칩이다(줄 끝 버튼은 칩과 너무 멀었다 — 2026-10-26). 원형이 아니면 원형으로 바꾸고 연다
    expect(ui).toMatch(/if\(ids\.some\(\(id\)=>\(FRAMES\.find\(\(f\)=>f\.id===id\)\|\|\{\}\)\.kind==='round'\)\) framesEl\.appendChild\(circleChip\(\)\);/);
    expect(fnSource(ui, 'circleChip')).toMatch(/if\(\(FRAMES\[state\.frameIdx\]\|\|\{\}\)\.kind!=='round'\)\{ const i=FRAMES\.findIndex\(\(f\)=>f\.kind==='round'\); if\(i>=0\) selectFrame\(i\); \}\n {4}openCircleSheet\(\);/);
    expect(fnSource(ui, 'updateFrameLine')).not.toMatch(/원 맞추기/);
    expect(html).toMatch(/<div class="sheet" id="circleSheet" role="dialog" aria-modal="true"/);
    // 여러 점이면 칸마다 그 작품의 원
    expect(html).toMatch(/const pieces=grp\.map\(\(g\)=>groupPiece\(g\.img, g\.work, style, g\.circle\)\);/);
  });

  it('장면 엔진에는 링 바깥색으로 채운 판을 넘기고 셰이더가 원으로 자른다 — 투명 둘레는 밉맵에서 검은 테(규칙 37)', () => {
    expect(html).toMatch(/px\.fillStyle=`rgb\(\$\{framed\._roundEdge\.join\(','\)\}\)`/);
    expect(scene).toMatch(/uniform float uRound;/);
    expect(scene).toMatch(/if \(uRound > 0\.5\) \{/);
    expect(scene).toMatch(/gl\.uniform1f\(_loc\.uRound, o\.round \? 1 : 0\);/);
    // 그림자는 판의 내접원을 그대로 옮긴 다각형 · 모서리 폐색은 없다
    expect(scene).toMatch(/function circleOnQuad\(q, n\)/);
    expect(scene).toMatch(/const cornerAO = u\.round \? 0 :/);
  });

  it('실치수 — 지름은 작품의 짧은 변, 화면 지름은 맞춘 원의 지름', () => {
    expect(html).toMatch(/const d=Math\.min\(cm\[0\],cm\[1\]\), S=framed\._roundArtPx\|\|Math\.min\(srcImg\.width,srcImg\.height\);/);   // 끄는 동안은 작은 판(srcImg) 기준
  });

  it('원형 묶음 설명이 사진 속 원에 테를 맞춘다고 말한다(묶음 설명 — 아래 "액자 종류별 묶음")', () => {
    expect(ui).toMatch(/\['원형','둥근 작품용, 사진 속 원에 테를 맞춰요',\['round-black','round-gold'\]\]/);
  });
});

describe('액자 종류별 묶음 · 재질 채우기 · 매끈한 마감 — 다른 액자는 픽셀까지 그대로', () => {
  const ids = [...html.matchAll(/\{ id:'([a-z-]+)', name:'/g)].map((m) => m[1]);
  const hiddenIds = html.split('\n').filter((l) => /^\s*\{ id:'/.test(l) && /hidden:true/.test(l)).map((l) => l.match(/id:'([a-z-]+)'/)![1]);
  const visible = ids.filter((id) => !hiddenIds.includes(id));

  it('금테 액자 3종은 뺐다(사용자 "일단 빼고") — 엔진의 띠 그리기는 남아 있다(되살릴 때 FRAMES 에 fillet 만)', () => {
    expect(ids.some((id) => /fillet/.test(id))).toBe(false);
    expect(html.split('\n').filter((l) => /^\s*\{ id:'/.test(l)).some((l) => /fillet:/.test(l))).toBe(false);
    expect(html).toMatch(/function drawFilletBand\(/);
  });

  it('플로터·슬림·박스가 같은 재질을 갖는다 — 박스는 아이보리뿐이었다', () => {
    // 2026-10-26 — 보이는 액자는 전부 사진(실버 플로터·코드 슬림 4종은 숨김, 아래 '숨긴 액자')
    for (const m of ['oak', 'walnut', 'black', 'white', 'champagne']) expect(visible, `floater-${m}`).toContain(`floater-${m}`);
    for (const id of ['oak-thin', 'walnut-thin', 'slim-black', 'slim-white', 'silver-thin']) expect(visible, id).toContain(id);
    for (const m of ['oak', 'walnut', 'black', 'white', 'ivory']) expect(ids, `box-${m}`).toContain(`box-${m}`);
    // 박스는 살이 두껍고 안쪽 벽이 넓다 — 플로터(얇은 살·좁은 갭)와 한눈에 갈린다
    // 박스는 사진 액자(앞면 + 깊은 안쪽 벽, 위 '박스 액자' 묶음) — 몰딩(.052~.055)보다 굵게
    expect(html).toMatch(/const BOX_RAIL=0\.06\d;/);
    expect(html.split('\n').filter((l) => /^\s*\{ id:'box-/.test(l))).toHaveLength(5);
  });

  it('화면은 종류별로 묶어 보인다 — 보이는 액자가 정확히 한 묶음에(빠진 건 기타로 · 숨긴 액자는 어디에도 없다)', () => {
    const frames = ids.map((id) => ({ id, hidden: hiddenIds.includes(id) }));
    const groups = new Function(`const FRAMES=${JSON.stringify(frames)}; ${ui.slice(ui.indexOf('const FRAME_GROUPS='), ui.indexOf('function buildFrames('))}; return frameGroups();`)() as [string, string, string[]][];
    expect(groups.map((g) => g[0])).toEqual(['몰딩', '넓은 몰딩', '슬림', '플로터', '박스', '원형', '기타']);
    const flat = groups.flatMap((g) => g[2]);
    expect(flat.sort()).toEqual([...visible].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });
  it('★ 묶음마다 무엇이 다른지 한 줄(2026-10-26 사용자) — 넓은 칸은 이름 옆, 좁은 칸은 칩 아래 줄에 고른 액자의 묶음 설명', () => {
    const groups = [...ui.matchAll(/\['([^']+)','([^']+)',\[/g)].map((m) => [m[1], m[2]]);
    expect(groups.length).toBe(7);
    // 휴대폰은 칩 아래 한 줄 — 이름 포함 약 26자라 설명은 20자 안팎(플로터 설명이 잘렸다)
    for (const [name, desc] of groups) expect(desc.length, `${name} 설명 '${desc}'`).toBeLessThanOrEqual(22);
    expect(ui).toMatch(/const ds=document\.createElement\('span'\); ds\.className='gdesc'; ds\.textContent=' — '\+gdesc;/);
    // 고른 액자 하나의 설명(예전 FRAME_NOTES)은 없앴다 — 줄에는 그 액자의 '묶음' 설명
    expect(ui).not.toMatch(/FRAME_NOTES/);
    expect(fnSource(ui, 'updateFrameLine')).toMatch(/const g=frameGroupOf\(f\.id\);/);
    // 넓은 칸: 설명은 이름 옆, 설명 줄은 감춘다
    expect(html).toMatch(/\.group \.gdesc\{display:none\}/);
    expect(html).toMatch(/\.group \.gdesc\{display:inline;font-weight:400;color:var\(--sub\);font-size:12px\}\n {4}#framesLine\{display:none\}/);
  });
  it('숨긴 액자 — 사진 액자로 대신한 코드 액자는 목록에서 빼고, 골라 둔 사람은 그 대신으로 연다', () => {
    expect(hiddenIds.sort()).toEqual(['floater-silver', 'slim-champagne', 'slim-oak', 'slim-silver', 'slim-walnut']);
    for (const id of hiddenIds) {
      const alias = html.split('\n').find((l) => l.includes(`{ id:'${id}',`))!.match(/alias:'([a-z-]+)'/)![1];
      expect(visible, `${id} → ${alias}`).toContain(alias);
    }
    expect(ui).toMatch(/const want=remembered && remembered\.hidden && remembered\.alias \? remembered\.alias : prefs\.frame;/);
  });

  it('금테가 없으면 띠 폭 0 — 사진 액자 판의 크기·배치가 예전과 같다', () => {
    expect(html).toMatch(/const fp = style\.fillet \? Math\.max\(3, Math\.round\(base\*FILLET_FRAC\)\) : 0;/);
    expect(html).toMatch(/const W=aw\+2\*\(matPx\+fp\)\+l\+r, H=ah\+2\*\(matPx\+fp\)\+t\+b;/);
    expect(html).toMatch(/if\(fp>0\) drawFilletBand\(ctx,ax,ay,aw,ah,fp,style\.fillet,ld\);/);
  });

  it('원형 링과 금테가 같은 금속 조명을 쓴다(metalLight 하나)', () => {
    expect(fnSource(html, 'roundRingLayer')).toMatch(/metalLight\(f,nr\*ux,nr\*uy,nz,L,Hh,occ\)/);
    expect(fnSource(html, 'drawFilletBand')).toMatch(/metalLight\(f,nr\*ux,nr\*uy,nz,L,Hh,occ\)/);
  });

  it('결을 누르는 건 블랙·실버·아이보리·화이트뿐 — 나무·골드는 결이 곧 재질이라 손대지 않는다', () => {
    for (const k of ['black', 'silver', 'ivory', 'white']) expect(html).toMatch(new RegExp(`  ${k}: +\\{[^\\n]*calm:0\\.\\d+ \\},`));
    for (const k of ['gold', 'wood', 'walnut']) {
      const line = html.split('\n').find((l) => new RegExp(`^  ${k}: +\\{ light:`).test(l));
      expect(line, k).toBeTruthy();
      expect(line, k).not.toMatch(/calm:/);
    }
    // calm 0 이면 결 줄 세기도 그대로(곱 1)
    expect(html).toMatch(/const a=\(metal\?0\.05:0\.10\)\*\(0\.45\+rnd\(\)\)\*\(1-calm\*0\.8\);/);
    expect(html).toMatch(/if\(calm>0 && c\.faceRGB\)\{/);
  });
});

describe('박물관 색 벽 3종 — 결이 짙은 벽(차콜·테라코타·올리브)의 결·얼룩·조명을 그대로 두고 색만', () => {
  const scenes = JSON.parse(read('scenes/scenes.json')).scenes as Record<string, unknown>[];
  // ⚠️ 처음엔 화이트 플라스터에서 옮겨 결이 거의 없는 색칠한 판이 됐다(고주파 결 1.2 ↔ 차콜 7.5 — "텍스처가 없어서 별로", 2026-10-26)
  it.each([['navy', 'charcoal'], ['burgundy', 'terracotta'], ['forest', 'olive']])('%s ← %s — 벽 무리 · 파일 · 썸네일 · 원본과 같은 광원', (id, src) => {
    const s = scenes.find((x) => x.id === id)!;
    const base = scenes.find((x) => x.id === src)!;
    expect(s, id).toBeTruthy();
    expect(s.group).toBe('wall');
    expect(existsSync(resolve(PUB, s.src as string))).toBe(true);
    expect(existsSync(resolve(PUB, s.thumb as string))).toBe(true);
    // 조명 낙차가 원본 그대로이므로 광원·영역·축척이 원본과 같아야 한다(다르면 그림자가 벽과 어긋난다)
    for (const k of ['lightDir', 'region', 'regionCm', 'regionAspect', 'wallAmt', 'focus', 'shadow', 'toneAmt', 'depth']) expect(s[k], `${id}.${k}`).toEqual(base[k]);
  });
  it('다시 만들 수 있게 스크립트가 있고(원본 = 결이 짙은 벽), 출처 문서에 적었다', () => {
    const script = readFileSync(resolve(__dirname, '../../scripts/recolor-wall.py'), 'utf-8');
    expect(script).toMatch(/\('wall27-navy\.jpg', 'wall21-charcoal\.jpg',/);
    expect(script).toMatch(/\('wall28-burgundy\.jpg', 'wall24-terracotta\.jpg',/);
    expect(script).toMatch(/\('wall29-forest\.jpg', 'wall22-olive\.jpg',/);
    expect(script).not.toMatch(/wall26-white-plaster\.jpg'\s*$/m);
    const prov = readFileSync(resolve(__dirname, '../../../docs/artlook-asset-provenance.md'), 'utf-8');
    expect(prov).toMatch(/wall27-navy/);
    expect(prov).toMatch(/wall21-charcoal/);
  });
});

describe('박스 액자 — 사진 액자(GPT 박스 사진 5종) · 사진을 못 받으면 코드로 그린 박스', () => {
  const meta = JSON.parse(read('frames/photo/frames.json')) as Record<string, { file: string; inner: number[]; w: number; h: number; wallFrom?: number }>;
  it.each([['box-oak', 'oak-deep'], ['box-walnut', 'walnut-deep'], ['box-black', 'black-deep'], ['box-white', 'white-deep'], ['box-ivory', 'ivory-deep']])('%s → 사진 %s · 코드 박스 fallback', (id, key) => {
    const line = html.split('\n').find((l) => l.includes(`{ id:'${id}',`))!;
    expect(line, id).toMatch(new RegExp(`kind:'photo', photo:'${key}', rail:BOX_RAIL, box:true, deep:true, fallback:\\{ kind:'floater', material:'[a-z]+', border:\\.03\\d, gap:\\.022, box:true \\}`));
    expect(existsSync(resolve(PUB, 'frames/photo', meta[key].file))).toBe(true);
    // 추출기가 앞면 → 벽 계단에서 잰 자리(살 폭 대비) — 앞면 ≈57% · 벽 ≈43%
    expect(meta[key].wallFrom!).toBeGreaterThan(0.45);
    expect(meta[key].wallFrom!).toBeLessThan(0.7);
    // 네 살이 같다(symmetrize) — 개구부를 뒤판 그림자까지 넓게 잡으면 한쪽 앞면이 통째로 깎였다
    const [ix, iy, ix2, iy2] = meta[key].inner;
    const rails = [ix, iy, meta[key].w - 1 - ix2, meta[key].h - 1 - iy2];
    expect(Math.max(...rails) - Math.min(...rails)).toBeLessThanOrEqual(1);
  });
  it('추출기 — deep 사진은 개구부를 벽 → 뒤판 계단에서 잡는다(뒤판 그림자 그라데이션까지 잡으면 한쪽 살이 40~50px 두꺼워진다)', () => {
    const ex = readFileSync(resolve(__dirname, '../../scripts/extract-photo-frames.py'), 'utf-8');
    expect(ex).toMatch(/def refine_deep\(/);
    expect(ex).toMatch(/if any\(q in os\.path\.basename\(f\)\.lower\(\) for q in \('deep', 'floater'\)\):\n {12}li, ri, ti, bi, wall_from = refine_deep\(/);
    // 'champagne'·'maple' 은 'floater' 앞 — 뒤에 두면 frame-champagne-floater 가 'floater' 로 잡힌다
    expect(ex).toMatch(/KEYS = \['oak', 'black', 'white', 'walnut', 'gold', 'silver', 'champagne', 'maple', 'floater', 'ivory'\]/);
    expect(ex).toMatch(/QUALS = \['thin', 'wide', 'deep', 'floater'\]/);
    expect(ex).toMatch(/meta\[name\]\['wallFrom'\] = wall_from/);
  });
  it('엔진 — 박스는 몰딩의 홈(리베이트) 규칙을 끄고, 벽 명암만 이 방의 빛으로 다시 나눈다', () => {
    const f = fnSource(html, 'shadeFrameProfile');
    expect(f).toMatch(/const absReb = !!o\.noMat && SYN_EDGE>0 && !box;/);
    expect(f).toMatch(/const recess = !!o\.recess && !o\.noMat && !rebOnly && SYN_EDGE>0 && !box;/);
    expect(f).toMatch(/\} else if\(!box\) \{/);
    expect(html).toMatch(/recess:PHOTO_RECESS>0 && !style\.deep, deep:!!style\.deep,/);
    expect(html).toMatch(/if\(style\.deep\) shadeBoxWalls\(ctx,W,H,l,t,r,b,ld,assetLightOf\(style\),meta\.wallFrom,fc\);/);
    const w = fnSource(html, 'shadeBoxWalls');
    expect(w).toMatch(/litIn=-\(nv\[0\]\*L\[0\]\+nv\[1\]\*L\[1\]\)/);              // 안쪽 벽은 안쪽을 향한다
    expect(w).toMatch(/Math\.min\(0\.98, avg\*\(1\+BOX_WALL_TILT\*litIn\)\)/);       // 평균은 지키고, 앞면보다 밝게는 안
    // 방향광 판단은 앞면만 — 벽까지 재면 위벽 그늘이 '아래서 온 빛'으로 읽힌다
    expect(fnSource(html, 'measureAssetLight')).toMatch(/const fr=meta\.wallFrom>0 \? meta\.wallFrom : 1;/);
    expect(html).toMatch(/style=style\.fallback \|\| \{ kind:'flat', material:'wood', border:\.028 \};/);
  });
  it('코드로 그린 박스(사진을 못 받았을 때) — 벽은 앞면과 같은 결 · 매트 없으면 떠 있는 그림자 없음 · 바탕은 벽 색', () => {
    expect(html).toMatch(/if\(style\.box\) drawBoxWalls\(ctx,W,H,border,gap,matC,ld, mat>0\);\n {4}else drawFloaterTray\(ctx,W,H,border,gap,matFaceRGB\(matC\),ld, mat>0\);/);
    const f = fnSource(html, 'drawBoxWalls');
    expect(f).toMatch(/paintMaterialStrip\(ctx,c,\(s===0\|\|s===2\)\?W:H,g\);/);
    expect(fnSource(html, 'drawTextureSide')).toMatch(/const tile=\(len\)=>paintMaterialStrip\(ctx,c,len,b\);/);
    expect(f).not.toMatch(/rgba\(255/);
    expect(html).toMatch(/if\(\(style\.kind==='floater' && !\(style\.box && mat<=0\)\) \|\| mat>0\) floatMountShadow\(ctx,ax,ay,aw,ah,base\);/);
  });
});

describe('2차 사진 액자(2026-10-26) — 플로터 5 · 슬림 2 · 메이플 · 실버 · 넓은 블랙/화이트 · 벽 3', () => {
  const meta = JSON.parse(read('frames/photo/frames.json')) as Record<string, { file: string; inner: number[]; w: number; h: number; wallFrom?: number }>;
  const lineOf = (id: string) => html.split('\n').find((l) => l.includes(`{ id:'${id}',`))!;
  it.each([['floater-oak', 'oak-floater'], ['floater-walnut', 'walnut-floater'], ['floater-black', 'black-floater'], ['floater-white', 'white-floater'], ['floater-champagne', 'champagne-floater']])(
    '%s → 사진 %s(안쪽 벽 + 어두운 틈이 사진에 담겨 있다 — 박스와 같은 deep 길)', (id, key) => {
      expect(lineOf(id)).toMatch(new RegExp(`kind:'photo', photo:'${key}', rail:FLOATER_RAIL, deep:true, fallback:\\{ kind:'floater'`));
      expect(existsSync(resolve(PUB, 'frames/photo', meta[key].file))).toBe(true);
      expect(meta[key].wallFrom!).toBeGreaterThan(0.5);   // 앞면 ≈60% · 벽 + 틈 ≈40%
      expect(meta[key].wallFrom!).toBeLessThan(0.75);
    });
  it.each([['slim-black', 'black-thin'], ['slim-white', 'white-thin'], ['maple', 'maple'], ['silver', 'silver'], ['black-wide', 'black-wide'], ['white-wide', 'white-wide']])(
    '%s → 사진 %s', (id, key) => {
      expect(lineOf(id)).toMatch(new RegExp(`kind:'photo', photo:'${key}', rail:0\\.0\\d+`));
      expect(existsSync(resolve(PUB, 'frames/photo', meta[key].file))).toBe(true);
      expect(meta[key].wallFrom).toBeUndefined();   // 몰딩·슬림은 안쪽 벽이 없다(몰딩 홈 규칙을 그대로 쓴다)
      const [ix, iy, ix2, iy2] = meta[key].inner;
      const rails = [ix, iy, meta[key].w - 1 - ix2, meta[key].h - 1 - iy2];
      expect(Math.max(...rails) - Math.min(...rails)).toBeLessThanOrEqual(1);
    });
  it('새 몰딩은 FRAMES 맨 뒤(앞 번호를 하니스가 쓴다) · 넓은 몰딩은 살을 굵게', () => {
    const all = [...html.matchAll(/\{ id:'([a-z-]+)', name:'/g)].map((m) => m[1]);
    expect(all.slice(-4)).toEqual(['maple', 'silver', 'black-wide', 'white-wide']);
    expect(html).toMatch(/const FLOATER_RAIL=0\.04\d;/);
    expect(lineOf('white-wide')).toMatch(/rail:0\.08\d/);
  });
  it('색 보정 — 채도가 높은 나무 사진만(오크 플로터·메이플·월넛 플로터·샴페인 플로터)', () => {
    expect(html).toMatch(/'oak-floater':\[0\.50,0\.97\], 'walnut-floater':\[0\.64,1\.0\], 'champagne-floater':\[0\.85,1\.0\], maple:\[0\.50,0\.97\],/);
  });
  const scenes = JSON.parse(read('scenes/scenes.json')).scenes as Record<string, unknown>[];
  it.each([['red-brick', 'wall30-red-brick.jpg', 0.56], ['fieldstone', 'wall31-fieldstone.jpg', 0.68], ['leaf-shadow', 'wall32-leaf-shadow.jpg', undefined]])(
    '벽 %s — 파일·썸네일 · 결 진정(렌더로 맞춘 값) · 광원은 왼쪽 위(사진에서 잼)', (id, file, calm) => {
      const s = scenes.find((x) => x.id === id)!;
      expect(s.src).toBe(`walls/${file}`);
      expect(existsSync(resolve(PUB, s.src as string))).toBe(true);
      expect(existsSync(resolve(PUB, s.thumb as string))).toBe(true);
      expect(s.group).toBe('wall');
      expect(s.wallCalm).toBe(calm);
      const [x, y] = s.lightDir as number[];
      expect(x).toBeLessThan(0); expect(y).toBeLessThan(0);
    });
  it('벽돌·자연석은 사진 속 실제 크기로(벽돌 한 줄 7.5cm × 19줄 ≈ 142cm → 걸 자리 97×91cm)', () => {
    expect(scenes.find((x) => x.id === 'red-brick')!.regionCm).toEqual([97, 91]);
    expect(scenes.find((x) => x.id === 'fieldstone')!.regionCm).toEqual([122, 115]);
  });
});

describe('끌 때 렉 — 끄는 동안만 작은 판·판 재사용·GL 한 번 읽기(손을 떼면 원래 화질로 한 번 더)', () => {
  it('끄는 동안(draft)만 작품을 긴 변 1000px 로 줄이고, 같은 판은 다시 만들지 않는다', () => {
    expect(html).toMatch(/const DRAFT_LONG=1000;/);
    expect(fnSource(html, 'draftOf')).toMatch(/if\(!state\.draft \|\| Math\.max\(img\.width,img\.height\)<=DRAFT_LONG\) return img;/);
    expect(fnSource(html, 'framedFor')).toMatch(/if\(!state\.draft\) return buildFramedCore\(img, style, o\);/);
    expect(html).toMatch(/const srcImg=draftOf\(state\.img\);[^\n]*\n {2}const framed=framedFor\(srcImg, FRAMES\[state\.frameIdx\], state\);/);
    expect(html).toMatch(/\.\.\.\(state\.draft \? \{ supersample: 1 \} : null\)/);
  });
  it('여러 점은 한 GL 화면에 이어 그리고(keep) 마지막에 한 번만 읽는다 · 판 자리만 돌린다(scissor)', () => {
    expect(scene).toMatch(/if \(!o\.keep\) \{\n {6}gl\.disable\(gl\.SCISSOR_TEST\);/);
    expect(scene).toMatch(/gl\.scissor\(bx0, H - by1, bx1 - bx0, by1 - by0\);/);
    expect(scene).toMatch(/keep: gi0 > 0/);
  });
});

describe('벽 캡션 카드 — 미술관 라벨처럼 작품 오른쪽 벽에', () => {
  it('기본은 꺼짐 · 켜면 기억(이 브라우저)', () => {
    expect(html).toMatch(/caption:false,/);
    expect(ui).toMatch(/state\.caption=prefs\.caption===true;/);
    expect(ui).toMatch(/savePrefs\(\{ caption:state\.caption \}\)/);
  });
  it('적을 게 없으면(작가·작품명 둘 다 없음) 붙이지 않는다 — 빈 카드는 "정보를 안 적었다"로 읽힌다', () => {
    const f = new Function(`${fnSource(html, 'captionLines')}; return captionLines;`)() as (w: unknown) => { text: string }[];
    expect(f({})).toEqual([]);
    expect(f({ medium: '캔버스에 유채', sizeText: '60 × 90 cm' })).toEqual([]);
    expect(f({ artist: '김하늘', title: '강', year: '2024', medium: '캔버스에 유채', sizeText: '60 × 90 cm' }).map((l) => l.text))
      .toEqual(['김하늘', '강, 2024', '캔버스에 유채', '60 × 90 cm']);
  });
  it('크기·간격은 벽의 실제 축척(regionCm) · 자리가 없으면 왼쪽, 그것도 없으면 붙이지 않는다', () => {
    const f = fnSource(scene, 'placeWallLabel');
    expect(f).toMatch(/const cw = label\.wCm \/ rw, ch = label\.hCm \/ rh/);
    expect(f).toMatch(/for \(const x0 of \[right \+ gap, left - gap - cw\]\)/);
    expect(f).toMatch(/if \(!q\) return null;/);
    // 카드도 판과 같은 워프(벽 명암·톤·그레인)를 거친다
    expect(f).toMatch(/warp\(label\.canvas, q, W, H, Object\.assign\(\{\}, lightOpts/);
  });
  it('카드를 붙일 때만 묶음이 가운데로 — 안 붙이면 배치가 예전과 같다(labelU 0)', () => {
    expect(scene).toMatch(/const labelU = \(u\.label && u\.label\.canvas && scene\.region && scene\.regionCm && scene\.frameless\)/);
    expect(scene).toMatch(/dx: \(a\.dx \|\| 0\) - labelU \/ 2/);
  });
  it('여러 점에서는 캡션이 없다(단추도 감춘다)', () => {
    expect(html).toMatch(/label: \(state\.caption && !grp\) \? captionCard\(selectedWork\) : null/);
    expect(ui).toMatch(/const canCaption=!multi && /);
  });
});

describe('리넨·스웨이드 매트', () => {
  it('매트를 칠하는 곳은 전부 matSurface — 모르는 마감은 종이(예전 그대로)', () => {
    const f = fnSource(html, 'matSurface');
    expect(f).toMatch(/if\(texture!=='linen' && texture!=='suede'\)\{ matPaper\(ctx,x,y,w,h,px,color\); return; \}/);
    const calls = [...html.matchAll(/(?<!function )matSurface\(ctx/g)].length;
    expect(calls).toBe(4);   // 사진 액자 · 플로터 · 슬림/화이트 매트 · 원형
    expect(html).toMatch(/matTexture:'paper'/);
  });
  it('색 줄 뒤쪽에 천 4종 — 색으로 구분되므로 기억은 색 하나', () => {
    expect(ui).toMatch(/\['#efebe2','리넨 화이트','linen'\]/);
    expect(ui).toMatch(/\['#3d3b38','스웨이드 차콜','suede'\]/);
    expect(ui).toMatch(/state\.matteColor=c; state\.matTexture=tex\|\|'paper';/);
    const cols = [...ui.matchAll(/\['(#[0-9a-f]{6})','/g)].map((m) => m[1]);
    expect(new Set(cols).size).toBe(cols.length);
  });
});

describe('여러 점 걸기(갤러리 월)', () => {
  type Rect = { x: number; y: number; w: number; h: number };
  const layout = new Function(`${fnSource(html, 'groupLayout')}; return groupLayout;`)() as
    (s: [number, number][], k: string, g: number) => { W: number; H: number; rects: Rect[] };
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const sizes: [number, number][] = [[100, 60], [60, 90], [50, 50], [30, 40]];

  it.each([['row', 2], ['col', 2], ['row', 3], ['big', 3], ['stairs', 3], ['grid', 4], ['row', 4], ['big', 4]] as const)(
    '%s %i점 — 겹치지 않고 묶음 안에 들어가며 크기(cm)는 그대로', (kind, n) => {
      const s = sizes.slice(0, n);
      const L = layout(s, kind, 8);
      L.rects.forEach((r, i) => {
        expect(r.w).toBeCloseTo(s[i][0]); expect(r.h).toBeCloseTo(s[i][1]);
        expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(L.W + 1e-9); expect(r.y + r.h).toBeLessThanOrEqual(L.H + 1e-9);
      });
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlap(L.rects[i], L.rects[j]), `${i}·${j}`).toBe(false);
    });

  it('가로 한 줄 — 간격 8cm · 가운데 높이 맞춤(전시 벽의 중심선)', () => {
    const L = layout(sizes.slice(0, 3), 'row', 8);
    expect(L.rects[1].x - (L.rects[0].x + L.rects[0].w)).toBeCloseTo(8);
    const mids = L.rects.map((r) => r.y + r.h / 2);
    expect(Math.max(...mids) - Math.min(...mids)).toBeCloseTo(0);
  });

  it('큰 그림 + 작은 그림 — 가장 큰(면적) 작품이 왼쪽', () => {
    const L = layout([[30, 40], [100, 60], [50, 50]], 'big', 8);
    expect(L.rects[1].x).toBe(0);
    expect(L.rects[0].x).toBeGreaterThan(100);
  });

  it('칸 크기는 높이만 실치수, 폭은 사진 비율 — 한 점과 같은 규칙(어긋나면 판이 늘어나 겹쳐 보였다)', () => {
    expect(fnSource(html, 'groupPiece')).toMatch(/cm=\[cmH\*img\.width\/img\.height, cmH\];/);
  });

  it('엔진 — 칸마다 같은 원근으로 끼우고 그림자는 한 경로로(겹친 자리 두 번 어둡지 않게) · 옆면은 없다', () => {
    expect(scene).toMatch(/const groupItems = group && Hg \? group\.map/);
    expect(scene).toMatch(/const casters = groupItems \? groupItems\.map/);
    expect(scene).toMatch(/const depth = scene\.frameless && !groupItems/);
  });

  it('★ 크기 조절 — [+]가 벽 한계에 막히면 남은 만큼 카메라를 당긴다(여러 점은 거의 늘 막혀 아무 일도 없었다)', () => {
    expect(scene).toMatch(/const userS = u\.scale == null \? 1 : u\.scale;/);
    expect(scene).toMatch(/const rem = plain && plain\.place \? plain\.place\.heightRatio \* userS \/ Math\.max\(1e-6, got\.place\.heightRatio\) : 1;/);
    // 화질 한도(원본 사진을 늘리는 배율)의 1.25배까지만
    expect(scene).toMatch(/const zCap = Math\.max\(zoom, \(u\.maxSrcScale == null \? 1\.15 : u\.maxSrcScale\) \* 1\.25 \/ base\);/);
  });

  it('★ 한 점 ↔ 여러 점을 오가면 크기·위치 조절을 처음대로 — 묶음에 맞춘 확대가 한 점에 한꺼번에 먹었다', () => {
    expect(ui).toMatch(/function resetAllAdj\(\)/);
    expect(ui).toMatch(/if\(was!==!!state\.group\) resetAllAdj\(\);/);
    expect(ui).toMatch(/const first=multi\[0\], was=!!state\.group; multi=null; state\.group=null; if\(was\) resetAllAdj\(\);/);
  });

  it('화면 — [여러 점] 칩은 작품 2점 이상 + WebGL 일 때만 · 최대 4점 · 배치 바꾸기', () => {
    expect(ui).toMatch(/function multiAvailable\(\)\{ return WORKS\.length>=2 && /);
    expect(html).toMatch(/const GROUP_GAP_CM=8, GROUP_MAX=4;/);
    expect(ui).toMatch(/actionButton\('배치 바꾸기', cycleGroupLayout\)/);
    expect(ui).toMatch(/toast\('한 번에 '\+GROUP_MAX\+'점까지 걸 수 있어요'\)/);
  });
});
