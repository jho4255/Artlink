/* ============================================================================
   ArtLook — 장면(Scene) 합성 엔진
   ----------------------------------------------------------------------------
   "정해진 틀에 원본을 끼운다."

   장면 = 액자가 이미 걸려 있는 실사 사진(Flux 로 사전 생성). 우리는 그 액자
   **구멍(opening)** 의 네 점을 알고 있고, 작품을 그 사각형에 **원근 워프**해서
   끼운 뒤 구운 그림자·반사·톤을 덮는다.

   ⚠️ 작품 픽셀은 워프 + 합성만 한다 — 생성 모델이 작품을 다시 그리지 않는다.
      (CLAUDE.md 18번: 작품은 자르지도 늘리지도 않는다. 여기서도 contain 만 쓰고
       남는 자리는 매트(대지)가 먹는다.)

   왜 이렇게 하나 — 예전 방식(절차적 몰딩 + 축정렬 사각형)의 한계:
     ① 액자를 Canvas 그라디언트로 '그려서' CG 티가 났다.
     ② 벽은 사진인데 작품만 정면 사각형이라 비스듬한 방에서 떠 보였다.
     ③ 그림자가 곱연산 얼룩 하나뿐이라 방 조명과 어긋났다.
   장면 방식은 ①을 사진으로, ②를 호모그래피로, ③을 구운 레이어로 해결한다.

   ── 파이프라인 ──
     buildInsert()  작품 + 매트 + 베벨 + 안쪽그림자 → '끼울 판' 캔버스
     warp()         WebGL2 역호모그래피로 판을 구멍 4점에 정확히 투영
     composeScene() 장면사진 → 워프된 판 → occlusion(multiply) → 반사(screen)

   ── 좌표 규약 ──
     구멍 quad 는 **사진 비율좌표**(0~1) 4점, 순서는 좌상→우상→우하→좌하.
     출력 캔버스로는 장면사진의 cover-fit 변환을 똑같이 먹여 픽셀좌표로 옮긴다.
   ========================================================================== */
(function (global) {
  'use strict';

  // ==========================================================================
  //  3×3 행렬 — 단위정사각형 → quad 호모그래피
  // ==========================================================================
  // (0,0)(1,0)(1,1)(0,1) → p0 p1 p2 p3 로 보내는 H. 닫힌 해라 반복 없이 정확하다.
  function homographyUnitToQuad(p) {
    const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dy1 * dx2;
    // 세 점이 일직선이면 역이 없다 — 호출부가 quad 를 검증하지만 여기서도 방어
    if (!isFinite(den) || Math.abs(den) < 1e-12) return null;
    const g = (sx * dy2 - sy * dx2) / den;
    const h = (dx1 * sy - dy1 * sx) / den;
    return [
      x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
      y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
      g, h, 1,
    ];
  }

  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
    const s = 1 / det;
    return [
      A * s, (c * h - b * i) * s, (b * f - c * e) * s,
      B * s, (a * i - c * g) * s, (c * d - a * f) * s,
      C * s, (b * g - a * h) * s, (a * e - b * d) * s,
    ];
  }

  // 열 우선(column-major) — WebGL uniformMatrix3fv 가 요구하는 순서
  function toColMajor(m) {
    return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // quad 의 대표 가로/세로 — 마주보는 변의 평균(원근이 있으면 위·아래 길이가 다르다)
  function quadSize(q) {
    return {
      w: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2,
      h: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2,
    };
  }

  // ==========================================================================
  //  WebGL2 워퍼 — 역호모그래피 + fwidth 가장자리 AA + 밉맵
  // ==========================================================================
  // 왜 WebGL 인가: Canvas2D 의 setTransform 은 **아핀**이라 원근을 못 만든다.
  // 삼각형 두 개로 쪼개 그리면 대각선에서 텍스처가 꺾인다(원근보정 없음).
  // 셰이더에서 픽셀마다 역행렬을 곱하면 그런 이음매 없이 정확하다.
  const VS = `#version 300 es
  in vec2 aPos;
  void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex;     // 끼울 판
  uniform sampler2D uScene;   // 장면 사진 (벽 명암을 읽는다)
  uniform mat3  uHinv;      // 화면 픽셀(y-down) → 판(uv)
  uniform float uH;         // 캔버스 높이 (gl_FragCoord 는 y-up 이라 뒤집는다)
  uniform vec3  uTone;      // 방 조명 색
  uniform float uToneAmt;   // 톤 매칭 세기
  uniform float uExposure;  // 노출 보정 (어두운 방이면 <1)
  uniform vec4  uFit;       // 장면사진의 cover-fit (dx,dy,sw,sh) — 화면→장면 uv
  uniform float uWallAmt;   // 벽 명암이 작품을 통과하는 세기
  uniform float uWallRef;   // 기준 밝기(구멍 주변 평균) — 이보다 어두우면 작품도 어두워진다
  uniform float uWallLod;   // 벽을 얼마나 흐리게 읽을지 (밉맵 단계)
  uniform float uGrain;     // 사진 그레인 세기
  out vec4 fragColor;

  // 소프트라이트(Pegtop) — 색을 덮어쓰지 않고 '물들이기'만 한다.
  vec3 softLight(vec3 base, vec3 blend){
    return (1.0 - 2.0 * blend) * base * base + 2.0 * blend * base;
  }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main(){
    vec2 sc = vec2(gl_FragCoord.x, uH - gl_FragCoord.y);
    vec3 t  = uHinv * vec3(sc, 1.0);
    if (t.z == 0.0) discard;
    vec2 uv = t.xy / t.z;

    // 가장자리 1px 페더 — discard 만 쓰면 계단이 진다.
    vec2 d = min(uv, vec2(1.0) - uv);
    vec2 w = fwidth(uv);
    float a = clamp(min(d.x / max(w.x, 1e-7), d.y / max(w.y, 1e-7)) + 0.5, 0.0, 1.0);
    if (a <= 0.002) discard;

    vec4 c = texture(uTex, uv);          // 암시적 미분 → 축소 시 밉맵이 먹는다
    vec3 rgb = clamp(c.rgb * uExposure, 0.0, 1.0);

    // ── 벽 명암 통과 ────────────────────────────────────────────────────
    // 경쟁 앱 리뷰의 '붙여넣은 티'는 대부분 여기서 온다. 방의 그라데이션(스포트
    // 라이트 낙차·창빛)이 작품 위로 이어지지 않으면 작품만 균일하게 떠 보인다.
    // 장면사진의 같은 자리 밝기를 읽어 기준 대비로 곱한다(=부분 강도 multiply).
    //
    // ⚠️ **반드시 흐린 단계(textureLod)로 읽을 것.** 원본 해상도로 읽으면 벽돌·돌
    //    무늬가 그대로 작품 위에 찍힌다(화이트브릭 벽에서 즉시 드러난다).
    //    우리가 원하는 건 '넓은 명암'이지 벽의 표면 무늬가 아니다.
    if (uWallAmt > 0.0) {
      vec2 suv = (sc - uFit.xy) / uFit.zw;
      if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
        vec3 s = textureLod(uScene, suv, uWallLod).rgb;
        float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
        float k = clamp(lum / max(uWallRef, 0.02), 0.55, 1.6);
        rgb *= mix(1.0, k, uWallAmt);
      }
    }

    rgb = mix(rgb, softLight(rgb, uTone), uToneAmt);

    // 사진 그레인 — 깨끗한 면이 그레인 있는 JPEG 위에 놓이면 즉시 티가 난다.
    if (uGrain > 0.0) rgb += (hash(sc) - 0.5) * uGrain;

    fragColor = vec4(clamp(rgb, 0.0, 1.0), c.a * a);
  }`;

  let _gl = null, _glCanvas = null, _prog = null, _tex = null, _sceneTex = null,
    _sceneKey = null, _loc = null, _glFailed = false;

  function initGL() {
    if (_gl || _glFailed) return _gl;
    try {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2', {
        alpha: true, premultipliedAlpha: false, antialias: false,
        preserveDrawingBuffer: true, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('no webgl2');

      const mk = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      _glCanvas = cv; _gl = gl; _prog = prog;
      _tex = gl.createTexture();
      _sceneTex = gl.createTexture();
      _loc = {
        uTex: gl.getUniformLocation(prog, 'uTex'),
        uScene: gl.getUniformLocation(prog, 'uScene'),
        uHinv: gl.getUniformLocation(prog, 'uHinv'),
        uH: gl.getUniformLocation(prog, 'uH'),
        uTone: gl.getUniformLocation(prog, 'uTone'),
        uToneAmt: gl.getUniformLocation(prog, 'uToneAmt'),
        uExposure: gl.getUniformLocation(prog, 'uExposure'),
        uFit: gl.getUniformLocation(prog, 'uFit'),
        uWallAmt: gl.getUniformLocation(prog, 'uWallAmt'),
        uWallRef: gl.getUniformLocation(prog, 'uWallRef'),
        uWallLod: gl.getUniformLocation(prog, 'uWallLod'),
        uGrain: gl.getUniformLocation(prog, 'uGrain'),
      };
      return _gl;
    } catch (e) {
      _glFailed = true;            // 폴백은 호출부에서 판단한다(예전 평면 합성으로)
      return null;
    }
  }

  const supported = () => !!initGL();

  /**
   * 판(insert)을 quad 에 원근 워프해 W×H 투명 캔버스로 돌려준다.
   * @param src   HTMLCanvasElement|HTMLImageElement — 끼울 판
   * @param quad  [[x,y]×4] 출력 픽셀좌표, 좌상→우상→우하→좌하
   */
  function warp(src, quad, W, H, opt) {
    const gl = initGL();
    if (!gl) return null;
    const o = opt || {};
    const Hm = homographyUnitToQuad(quad);
    if (!Hm) return null;
    const Hinv = inv3(Hm);
    if (!Hinv) return null;

    if (_glCanvas.width !== W || _glCanvas.height !== H) { _glCanvas.width = W; _glCanvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.useProgram(_prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, _tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // 판이 구멍보다 크면(거의 항상) 축소가 일어난다 → 밉맵이 없으면 지글거린다.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }

    // 장면 사진 — 벽 명암을 읽는 두 번째 텍스처. 같은 사진이면 다시 올리지 않는다
    // (매 렌더 texImage2D 하면 4K 사진에서 드래그가 끊긴다).
    let wallAmt = o.wallAmt == null ? 0 : o.wallAmt;
    if (wallAmt > 0 && o.sceneImg && o.fit) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, _sceneTex);
      const key = o.sceneKey || (o.sceneImg.src || '');
      if (_sceneKey !== key) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, o.sceneImg);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        // 벽의 **넓은 명암**만 원한다 — 미세 텍스처까지 곱하면 작품에 벽지 무늬가 낀다.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        _sceneKey = key;
      }
      gl.uniform1i(_loc.uScene, 1);
      gl.uniform4f(_loc.uFit, o.fit.dx, o.fit.dy, o.fit.sw, o.fit.sh);
      gl.uniform1f(_loc.uWallRef, o.wallRef == null ? 0.6 : o.wallRef);
      // ⚠️⚠️ **밉맵 단계를 고정값으로 두지 말 것 — 큰 장면 사진에서 무늬가 새어 나온다.**
      //   예전엔 5단계 고정이었는데, 이건 '1/32 축소'라는 **상대** 값이라 사진이 클수록
      //   덜 흐려진다. 2600px 매크로 벽(스톤·벽돌)에서는 81텍셀이 남아 줄눈이 그대로
      //   작품 위에 곱해졌다 — 단색 작품을 걸어 실측하니 **스톤 20%·회벽돌 25%** 가
      //   통과했고(인테리어 사진 1254px 은 6%), 눈으로도 돌벽이 그대로 비쳤다
      //   (2026-08-30 사용자 신고: "그림이 투명해져서 벽문양이 비친다").
      //   우리가 원하는 건 **넓은 조명 낙차**지 벽의 표면 무늬가 아니다. 그러니 사진
      //   크기와 무관하게 **같은 굵기(≈11텍셀)로** 뭉갠다. 스포트라이트·창빛 낙차는
      //   화면의 1/3~1/2 크기라 18텍셀 맵에서도 충분히 남는다.
      const sw = o.sceneImg.naturalWidth || o.sceneImg.width || 1;
      const sh = o.sceneImg.naturalHeight || o.sceneImg.height || 1;
      const autoLod = Math.log2(Math.max(2, Math.max(sw, sh) / 11));
      gl.uniform1f(_loc.uWallLod,
        o.wallLod == null ? Math.min(9, Math.max(4, autoLod)) : o.wallLod);
    } else {
      wallAmt = 0;
    }

    const tone = o.tone || [0.5, 0.5, 0.5];
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(_loc.uTex, 0);
    gl.uniformMatrix3fv(_loc.uHinv, false, toColMajor(Hinv));
    gl.uniform1f(_loc.uH, H);
    gl.uniform3f(_loc.uTone, tone[0], tone[1], tone[2]);
    gl.uniform1f(_loc.uToneAmt, o.toneAmt == null ? 0 : o.toneAmt);
    gl.uniform1f(_loc.uExposure, o.exposure == null ? 1 : o.exposure);
    gl.uniform1f(_loc.uWallAmt, wallAmt);
    gl.uniform1f(_loc.uGrain, o.grain == null ? 0 : o.grain);

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return _glCanvas;
  }

  // ==========================================================================
  //  판(insert) — 매트(대지) + 작품 + 베벨 + 안쪽 그림자
  // ==========================================================================
  // 비율 문제의 답이 여기 있다: 구멍은 비율이 하나인데 작품은 제각각이다.
  // 실제 액자가 쓰는 방식 그대로 — **큰 구멍 안에 매트를 깔고 작품을 contain** 하면
  // 어떤 비율이든 잘리지 않고 우아하게 앉는다. 비율 전용 액자는 매트를 얇게 주면 된다.
  const MAT_TEXTURE_SEED = 20260830;

  function prng(seed) {
    let s = (seed * 2654435761) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  let _paper = null;
  function paperPattern() {
    if (_paper) return _paper;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const id = x.createImageData(128, 128);
    const rnd = prng(MAT_TEXTURE_SEED);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 236 + rnd() * 19 | 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    _paper = c;
    return c;
  }

  function hexToRgb(h) {
    h = String(h || '#ffffff').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  function mixHex(hex, target, amt) {
    const { r, g, b } = hexToRgb(hex);
    const t = hexToRgb(target);
    return `rgb(${clamp255(r + (t.r - r) * amt)},${clamp255(g + (t.g - g) * amt)},${clamp255(b + (t.b - b) * amt)})`;
  }

  /**
   * 구멍에 끼울 판을 만든다.
   * @param art  HTMLCanvasElement|Image — 원본 작품 (잘리지 않는다)
   * @param o    { W,H            판 픽셀 크기(구멍의 화면 크기 × 슈퍼샘플)
   *               mat            매트 최소 여백 (짧은 변 대비 0~0.35). 0 이면 매트 없음
   *               matColor       매트 색
   *               bevel          베벨(코어 흰 테) 표시
   *               innerShadow    액자 안쪽이 작품에 드리우는 그림자 세기 (0~1)
   *               glass          유리 반사 세기 (0~1, 0 이면 없음)
   *               lightDir       광원 방향 [x,y] (기본 좌상단)
   *               canvasTexture  캔버스 직조 질감 */
  function buildInsert(art, o) {
    const W = Math.max(8, Math.round(o.W)), H = Math.max(8, Math.round(o.H));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const aw = art.naturalWidth || art.width, ah = art.naturalHeight || art.height;
    const ld = o.lightDir || [-1, -1];
    const matPct = Math.max(0, Math.min(0.35, o.mat == null ? 0 : o.mat));
    const matColor = o.matColor || '#f4f1ea';

    // ── 매트 판 ──────────────────────────────────────────────────────────
    if (matPct > 0) {
      ctx.fillStyle = matColor;
      ctx.fillRect(0, 0, W, H);
      // 종이 결 — 균일한 색면은 즉시 CG 로 읽힌다
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ctx.createPattern(paperPattern(), 'repeat');
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      // 매트 표면의 완만한 광량 기울기(위가 밝고 아래가 어둡게)
      const mg = ctx.createLinearGradient(0, 0, -ld[0] * W * 0.5, -ld[1] * H);
      mg.addColorStop(0, 'rgba(255,255,255,.10)');
      mg.addColorStop(1, 'rgba(0,0,0,.07)');
      ctx.fillStyle = mg;
      ctx.fillRect(0, 0, W, H);
    }

    // ── 작품 자리 (contain — 절대 자르지 않는다) ───────────────────────────
    const m = matPct * Math.min(W, H);
    const availW = W - 2 * m, availH = H - 2 * m;
    const s = Math.min(availW / aw, availH / ah);
    const dw = Math.max(1, Math.round(aw * s)), dh = Math.max(1, Math.round(ah * s));
    const dx = Math.round((W - dw) / 2), dy = Math.round((H - dh) / 2);

    // 매트가 없을 때 남는 자리는 배경이 비칠 수 없다(구멍 뒤는 액자 내부다) →
    // 아주 어두운 판으로 채워 '뒤판'처럼 보이게 한다.
    if (o.backing !== false && matPct <= 0 && (dw < W - 1 || dh < H - 1)) {
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, W, H);
    } else if (matPct <= 0 && (dw < W || dh < H)) {
      // ⚠️⚠️ **판 둘레에 투명 픽셀을 남기지 말 것.** 워프는 축소할 때 밉맵을 쓰는데,
      //   투명 픽셀의 RGB 는 (0,0,0) 이라 가장자리 텍셀이 **검정과 평균**돼 조각 둘레가
      //   어두워진다(언프리멀티플라이드 알파의 고전적 검은 테).
      //   실측 2026-08-30: 벽 183 · 살 222 사이의 경계 픽셀이 182,157,132 — 양쪽보다 어둡다.
      //   투명이 0px 이면 210,177,142 로 정상. contain 반올림으로 생기는 **1px 여백만으로도**
      //   생기므로, 밑에 늘려 깔아 투명을 없앤다. 보이는 자리는 정확한 contain 배치가
      //   덮으므로 작품이 늘어나지 않는다(CLAUDE.md 18).
      ctx.drawImage(art, 0, 0, W, H);
    }

    ctx.drawImage(art, dx, dy, dw, dh);

    // 캔버스 직조 질감 (회화는 매끈한 인쇄면이 아니다)
    if (o.canvasTexture) {
      ctx.save();
      ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = ctx.createPattern(paperPattern(), 'repeat');
      ctx.fillRect(dx, dy, dw, dh);
      ctx.restore();
    }

    // ── 베벨 — 매트를 45°로 자른 단면(코어 흰색). 얇지만 이게 있어야 '끼워진' 느낌 ──
    if (matPct > 0 && o.bevel !== false) {
      const bev = Math.max(1.5, Math.min(W, H) * 0.006);
      const core = mixHex(matColor, '#ffffff', 0.72);
      ctx.save();
      ctx.strokeStyle = core;
      ctx.lineWidth = bev;
      ctx.strokeRect(dx - bev / 2, dy - bev / 2, dw + bev, dh + bev);
      // 방향광 — 광원 반대쪽 단면은 그늘진다
      ctx.globalCompositeOperation = 'multiply';
      const bg = ctx.createLinearGradient(dx, dy, dx - ld[0] * dw, dy - ld[1] * dh);
      bg.addColorStop(0, 'rgba(255,255,255,1)');
      bg.addColorStop(1, 'rgba(150,146,138,1)');
      ctx.strokeStyle = bg;
      ctx.strokeRect(dx - bev / 2, dy - bev / 2, dw + bev, dh + bev);
      ctx.restore();
    }

    // ── 매트가 작품에 드리우는 그림자 (매트는 작품 '앞'에 있다) ──────────────
    if (matPct > 0) {
      const sh = Math.max(2, Math.min(dw, dh) * 0.012);
      ctx.save();
      ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
      const sides = [
        [dx, dy, dx, dy + sh, ld[1] < 0],           // 위
        [dx, dy, dx + sh, dy, ld[0] < 0],           // 왼
        [dx, dy + dh, dx, dy + dh - sh, ld[1] > 0], // 아래
        [dx + dw, dy, dx + dw - sh, dy, ld[0] > 0], // 오른
      ];
      for (const [x0, y0, x1, y1, strong] of sides) {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(0,0,0,${strong ? 0.34 : 0.14})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(dx, dy, dw, dh);
      }
      ctx.restore();
    }

    // ── 액자 안쪽 폐색(occlusion) — 구운 맵이 없을 때의 절차적 대체 ────────────
    // 구멍 가장자리로 갈수록 어두워진다. 이게 없으면 판이 액자 위에 '떠' 보인다.
    // ⚠️ **사진 속 액자 구멍에 끼울 때만 옳다.** 판이 '액자까지 포함한 조각'일 때
    //    이걸 걸면 액자의 **바깥 테두리**가 벽에 닿는 자리에서 어두워져, 조각 둘레에
    //    검은 테가 생긴다(실측 2026-08-30: 살 177 → 138, 스파이크 38.5).
    //    호출부가 opening 장면에서만 켠다.
    const occ = o.innerShadow == null ? 0.22 : o.innerShadow;
    if (occ > 0) {
      const t = Math.max(2, Math.min(W, H) * 0.035);
      ctx.save();
      const edges = [
        [0, 0, 0, t], [0, H, 0, H - t], [0, 0, t, 0], [W, 0, W - t, 0],
      ];
      for (let i = 0; i < edges.length; i++) {
        const [x0, y0, x1, y1] = edges[i];
        // 광원 쪽 모서리는 덜 어둡다
        const dir = i < 2 ? ld[1] : ld[0];
        const near = (i === 0 || i === 2) ? dir < 0 : dir > 0;
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, `rgba(0,0,0,${occ * (near ? 1 : 0.55)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    // ── 유리 반사 — 대각 스트릭. 과하면 즉시 가짜가 되므로 기본은 아주 옅게 ────
    const glass = o.glass == null ? 0 : o.glass;
    if (glass > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createLinearGradient(0, H, W, 0);
      g.addColorStop(0.00, 'rgba(255,255,255,0)');
      g.addColorStop(0.42, `rgba(255,255,255,${0.10 * glass})`);
      g.addColorStop(0.52, `rgba(255,255,255,${0.20 * glass})`);
      g.addColorStop(0.62, `rgba(255,255,255,${0.06 * glass})`);
      g.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    return { canvas: c, artRect: { x: dx, y: dy, w: dw, h: dh } };
  }

  // ==========================================================================
  //  입체 — 작품은 벽에 그려진 그림이 아니라 **벽에서 떠 있는 상자**다
  // ==========================================================================
  // 경쟁 앱(FrameIt) 결과물을 확대해 보면 결정적 차이가 여기 있다. 갤러리랩 캔버스는
  // **감싸진 옆면**이 보이고, 액자는 바깥 측면이 드러난다. 우리는 납작한 링 하나였다.
  // 그림자·톤을 아무리 맞춰도 두께가 없으면 '벽에 인쇄한 그림'으로 보인다.
  //
  // 모델: 뒷면(back)은 벽에 닿아 있고, 앞면(front)은 두께 d 만큼 앞으로 나와 있다.
  //   front = 중심 기준으로 살짝 확대(가까우니까) + 시선 방향으로 평행이동
  // 진짜 핀홀 카메라를 풀지 않는 이유 — 두께가 작품의 5% 수준이라 사교(oblique) 근사와
  // 눈으로 구분되지 않고, 장면 사진의 카메라를 우리가 모르기 때문이다.
  function boxFaces(back, opt) {
    const o = opt || {};
    const t = Math.max(0, Math.min(0.2, o.depth == null ? 0 : o.depth));
    if (t <= 0.0005) return { front: back, sides: [] };
    const size = quadSize(back);
    const d = Math.min(size.w, size.h) * t;
    const V = o.view || [-0.5, 0.2];
    const cx = (back[0][0] + back[1][0] + back[2][0] + back[3][0]) / 4;
    const cy = (back[0][1] + back[1][1] + back[2][1] + back[3][1]) / 4;
    const s = 1 + t * (o.persp == null ? 0.22 : o.persp);   // 가까운 면이 조금 크다
    const ox = V[0] * d, oy = V[1] * d;
    const front = back.map(([x, y]) => [cx + (x - cx) * s + ox, cy + (y - cy) * s + oy]);

    // 어느 옆면이 보이나 — 앞면이 뒷면을 덮으면 안 보인다(정면에서 보면 옆면이 없다).
    // 앞면 각 변의 바깥쪽에 뒷면 변이 삐져나와 있으면 그 옆면이 드러난다.
    const EDGES = [[0, 1, 'top'], [1, 2, 'right'], [2, 3, 'bottom'], [3, 0, 'left']];
    const sides = [];
    for (const [a, bI, name] of EDGES) {
      const fa = front[a], fb = front[bI];
      const ex = fb[0] - fa[0], ey = fb[1] - fa[1];
      // quad 가 시계방향(TL→TR→BR→BL, y-down)이므로 바깥 법선은 (ey, -ex)
      const nx = ey, ny = -ex;
      const mx = (back[a][0] + back[bI][0]) / 2 - (fa[0] + fb[0]) / 2;
      const my = (back[a][1] + back[bI][1]) / 2 - (fa[1] + fb[1]) / 2;
      const out = (mx * nx + my * ny) / Math.max(1e-6, Math.hypot(nx, ny));
      if (out <= 1.5) continue;                        // 1.5px 미만은 두께가 아니라 얼룩으로 보인다
      // 옆면 quad: 앞면 변 → 뒷면 변. TL→TR→BR→BL 순서를 지켜야 워프가 맞는다
      sides.push({ name, out, quad: [fa, fb, back[bI], back[a]] });
    }
    return { front, sides, depthPx: d };
  }

  // 옆면에 입힐 텍스처 — **판의 가장자리 픽셀 띠**를 뽑아 쓴다.
  // 갤러리랩 캔버스는 실제로 그림이 모서리를 감싸므로 이게 물리적으로 맞고,
  // 액자도 측면이 앞면 테두리와 같은 나무·금속이라 좋은 근사가 된다.
  // 옆면 quad 는 [앞변시작, 앞변끝, 뒷변끝, 뒷변시작] 순서라, 텍스처는
  //   가로(u) = 그 변을 따라가는 방향, 세로(v) = 앞면 → 벽 방향
  // 이어야 한다. 변마다 원본에서 어느 방향으로 읽어야 하는지가 달라서 선형변환으로 못박는다.
  // (setTransform(a,b,c,d,e,f): (x,y) → (a·x + c·y + e, b·x + d·y + f))
  function edgeStrip(src, side, thick, inset) {
    const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
    const th = Math.max(1, Math.min(Math.round(thick), Math.floor(Math.min(w, h) / 3)));
    // ⚠️ **맨 바깥 몇 픽셀은 건너뛴다.** 액자 앞면에는 가장자리를 또렷하게 하려고 그린
    //    어두운 외곽선이 있는데, 그걸 그대로 측면 텍스처로 뽑으면 옆면이 **새까맣게**
    //    나와 액자 옆이 아니라 검은 틈처럼 보인다(샴페인 플로터에서 즉시 드러났다).
    const ins = Math.max(0, Math.round(inset == null ? Math.min(w, h) * 0.012 : inset));
    const along = (side === 'top' || side === 'bottom') ? w : h;
    const c = document.createElement('canvas');
    c.width = along; c.height = th;
    const ctx = c.getContext('2d');
    // quad 순서: top=[0,1](좌→우) right=[1,2](위→아래) bottom=[2,3](우→좌) left=[3,0](아래→위)
    if (side === 'top') ctx.setTransform(1, 0, 0, 1, 0, -ins);            // u=x,   v=y-ins
    else if (side === 'right') ctx.setTransform(0, -1, 1, 0, 0, w - ins); // u=y,   v=w-x-ins
    else if (side === 'bottom') ctx.setTransform(-1, 0, 0, -1, w, h - ins);// u=w-x, v=h-y-ins
    else ctx.setTransform(0, 1, -1, 0, h, -ins);                          // u=h-y, v=x-ins
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 앞(v=0) → 벽(v=th) 으로 갈수록 어두워진다. 옆면이 균일하면 종잇장처럼 보인다 —
    // 이 낙차가 '두께가 있다'는 신호의 절반이다.
    // ⚠️ **맨 끝을 가장 어둡게 만들지 말 것.** 옆면의 마지막 픽셀이 바깥 그림자보다
    //    어두우면 그게 곧 조각 둘레의 검은 테가 된다(캔버스랩 아랫변 실측 27.4).
    //    벽에 가까워질수록 어두워지되, 마지막 15% 는 접지 그림자에 넘긴다.
    const g = ctx.createLinearGradient(0, 0, 0, th);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.85, 'rgba(0,0,0,.30)');
    g.addColorStop(1, 'rgba(0,0,0,.24)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, along, th);
    return c;
  }

  // quad 를 중심 기준으로 px 만큼 바깥으로 부풀린다 (그림자를 파낼 때 쓴다)
  function grow(q, px) {
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
    const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    return q.map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy) || 1;
      return [x + (x - cx) / d * px, y + (y - cy) / d * px];
    });
  }

  // 그림자 전용 레이어 — 한 장을 재사용한다(매 렌더 4K 캔버스를 새로 만들면 드래그가 끊긴다)
  let _shadowCv = null;
  function shadowLayer(W, H) {
    if (!_shadowCv) _shadowCv = document.createElement('canvas');
    if (_shadowCv.width !== W || _shadowCv.height !== H) { _shadowCv.width = W; _shadowCv.height = H; }
    const c = _shadowCv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, W, H);
    return c;
  }

  // ==========================================================================
  //  장면 합성
  // ==========================================================================
  // 장면사진을 출력 캔버스에 cover-fit 으로 깔고, 같은 변환으로 quad 를 픽셀좌표로.
  function fitScene(img, W, H, focus, zoom) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sc = Math.max(W / iw, H / ih) * (zoom > 0 ? zoom : 1);
    const fx = focus ? focus[0] : 0.5, fy = focus ? focus[1] : 0.5;
    // 벽이 위쪽이라 평소엔 살짝 위(0.45)에 둔다.
    // ⚠️ **확대했을 때 정확히 한가운데(0.5)로 두지 말 것.** 자동 프레이밍이 도입되면서
    //    거의 항상 확대되는 바람에 조각이 늘 **기계적으로 정중앙**에 놓였다(실측 중심
    //    이탈 0.0%). 실제 인테리어 사진은 카메라가 눈높이라 작품이 화면 중앙보다 조금
    //    위에 온다 — 골든도 0.1~3.4%(중앙 0.7) 벗어나 있다. 0.485 면 1~2% 위로 온다.
    let dx = W * 0.5 - fx * iw * sc;
    let dy = H * (zoom > 1.02 ? 0.485 : 0.45) - fy * ih * sc;
    dx = Math.min(0, Math.max(W - iw * sc, dx));
    dy = Math.min(0, Math.max(H - ih * sc, dy));
    return { dx, dy, sw: iw * sc, sh: ih * sc, zoom: zoom > 0 ? zoom : 1 };
  }

  const mapQuad = (quad, fit) =>
    quad.map(([u, v]) => [fit.dx + u * fit.sw, fit.dy + v * fit.sh]);

  // ==========================================================================
  //  벽 영역 안에서 작품 크기 정하기 — 실제 치수(cm) 스케일
  // ==========================================================================
  // 장면은 두 방식 중 하나로 자리를 알려준다.
  //   ① opening : 사진에 이미 있는 **액자 구멍** 4점. 작품은 그 안에 매트로 앉는다.
  //   ② region  : 벽의 **걸 수 있는 영역** 4점 + 그 영역의 실제 비율/치수.
  //               작품 비율 그대로(자르지 않고) 그 안에 놓는다 — 캔버스만 거는 장면용.
  //
  // ②가 중요한 이유: 경쟁 앱 리뷰의 최다 불만이 "방마다 작품 크기가 제각각"이다.
  // region 의 실치수(regionCm)와 작품 실치수(artCm)를 알면 **30호와 100호가 같은 방에서
  // 다르게 보인다**. 치수를 모르면 영역의 기본 비율만큼 채운다(예전과 같은 동작).
  //
  // ⚠️ 원근이 있는 벽에서도 맞아야 하므로, 크기 계산은 **영역의 평면 좌표(unit)** 에서
  //    하고 그 결과를 호모그래피로 화면에 보낸다. 화면 픽셀에서 직접 재면 기울어진
  //    벽에서 위아래 폭이 달라 어긋난다.
  function placeInRegion(regionQuad, opt) {
    const o = opt || {};
    const H = homographyUnitToQuad(regionQuad);
    if (!H) return null;
    const aspect = o.regionAspect > 0 ? o.regionAspect : 1;   // 영역의 실제 가로/세로
    const A = o.artAspect > 0 ? o.artAspect : 1;              // 작품의 가로/세로

    // ── 크기 정하기 — **실제 크기 하나뿐** (2026-08-31) ─────────────────────
    // 예전엔 '보기 좋게'(실치수를 압축 반영)가 기본이고 '실제 크기'가 선택이었다.
    // 지금은 실치수를 아는 작품이면 **언제나 벽 대비 실제 비율 그대로** 건다 —
    // 30호와 100호가 같은 방에서 정말로 다르게 보인다.
    // 작아 보이는 문제는 크기를 부풀려서가 아니라 **카메라를 당겨서** 푼다
    // (`composeScene` 의 자동 프레이밍). 사진가가 하는 것과 같고, 비례는 거짓말하지 않는다.
    // ⚠️ 작품을 자르거나 늘리지는 않는다 — 바뀌는 건 벽에서 차지하는 크기뿐이다.
    const FILL_DEFAULT = 0.62;   // 장면이 `fill` 을 직접 지정할 때만 쓰는 채움 비율
    // ⚠️⚠️ **치수를 모른다고 '최대치'로 걸지 말 것** (2026-09-03 신고).
    //   예전엔 치수가 없으면 `fill`(0.62) 에 자동 프레이밍 `gain` 까지 걸려 화면 상한까지
    //   커졌다. 그 결과 **크기를 모르는 작품이 100호보다 크게** 걸렸다 —
    //   실측(minsize.mjs): 흰 벽돌 70.0% ↔ 100호 65.7%, 컬렉터 살롱 49.0% ↔ 100호 38.2%.
    //   모르는 값을 최댓값으로 놓는 셈이라 앞뒤가 안 맞고, 실서버 작품의 **97% 가 이 경로**다.
    //   대신 **중간 크기(30호, 높이 90cm)로 가정**하고 실치수와 똑같은 경로를 태운다.
    //   장면마다 `regionCm` 이 다르므로 그 방에 맞는 크기가 자동으로 나온다.
    //   ⚠️ `trueScale` 로 치지는 않는다 — 안내문이 "실제 크기"라고 말하면 거짓말이 된다.
    const ASSUMED_CM = 90;
    let t;                       // 작품 높이 (영역 높이 = 1 기준)
    let trueScale = false;
    let assumed = false;
    // gain — 자동 프레이밍이 '영역 안에서' 키우는 배수. 사용자 조절(scale)과 **별개**다.
    // ⚠️ **실치수를 아는 작품에는 쓰지 않는다**(호출부가 안 준다) — 벽 대비 비율이 곧
    //    정직한 치수인데 여기에 배수를 곱하면 작품 크기가 거짓말이 된다.
    const gain = o.gain > 0 ? o.gain : 1;
    const knowCm = !!(o.regionCm && o.artCm && o.regionCm[1] > 0 && o.artCm[1] > 0);
    if (knowCm) {
      t = o.artCm[1] / o.regionCm[1];
      trueScale = true;
    } else if (o.fill == null && o.regionCm && o.regionCm[1] > 0) {
      t = ASSUMED_CM / o.regionCm[1];                         // 치수를 모를 때 = 30호로 가정
      assumed = true;
    } else {
      t = o.fill == null ? FILL_DEFAULT : o.fill;             // 장면이 채움 비율을 지정한 경우
    }
    // ── 영역 상한 ─────────────────────────────────────────────────────────
    // ⚠️ **작품이 벽 한 면을 꽉 채우게 두지 말 것** (2026-08-31 신고).
    //   `maxT` 가 1.0 이라 영역보다 큰 작품은 **벽 끝에서 끝까지** 걸렸다. 실측:
    //   흰 벽돌 영역이 163×154cm 인데 100호(130×162)는 세로가 영역보다 커서 100%,
    //   50호(91×116)도 75% 였다. 실제로 그렇게 거는 사람은 없고, 홍보 사진으로도
    //   벽 여백이 없으면 액자가 아니라 벽지처럼 보인다.
    //   최소 크기(FLOOR/KNEE)와 짝이 되는 **위쪽 바닥**이다.
    //   ⚠️⚠️ **딱딱한 상한(clamp)으로 두지 말 것** — 아래쪽 바닥에서 겪은 것과 같은 실수다.
    //   0.72 로 자르니 50호와 100호가 **똑같이 0.72** 가 되어 큰 작품끼리 구분이 사라졌다.
    //   무릎 위로는 **포화 곡선**으로 눌러 순서를 지키고 천장에는 닿지 않게 한다.
    //     t' = KH + (CEIL−KH)·(t−KH)/((t−KH)+(CEIL−KH))
    //   실측(흰 벽돌): 30호 0.59→0.59(무변화) · 50호 0.75→0.67 · 100호 1.05→0.73.
    const physMax = Math.min(1, aspect / A);        // 물리적으로 영역에 들어가는 한계
    const CEIL = o.fillCeil == null ? 0.60 : o.fillCeil;  // 벽 여백을 최소 40% 남긴다
    //   ⚠️ **무릎을 천장에 붙여 두지 말 것.** 천장을 0.82 → 0.60 으로 내리면서 무릎(0.55)을
    //   그대로 두면 곡선이 놓일 자리가 0.05 밖에 안 남아 30호·50호·100호가
    //   0.572·0.590·0.596 으로 **다시 뭉친다**(= 기각했던 clamp 로 되돌아간다).
    //   천장에 비례해 함께 내린다.
    const KH = o.fillKnee == null ? CEIL * 0.67 : o.fillKnee;   // 여기까지는 손대지 않는다
    const over = t > physMax;                       // 안내문은 **물리 한계** 기준 그대로
    // ⚠️ **천장은 '실치수 배치'에만 건다.** `fill`(장면이 정한 기본 채움)이나 `gain`
    //   (자동 프레이밍), 사용자 휠 조절까지 누르면 그건 크기 정직성과 무관한 걸 막는 것이고,
    //   실제로 기본 채움 0.5 가 0.47 로, gain 1.3 배가 1.19 배로 깎였다(테스트가 잡았다).
    //   신고("아무리 커도 벽을 꽉 채운다")는 **치수를 아는 큰 작품** 이야기다.
    const squeeze = (v) => (v <= KH ? v : KH + (CEIL - KH) * (v - KH) / ((v - KH) + (CEIL - KH)));
    if (trueScale || assumed) t = squeeze(t);   // 가정 크기도 같은 상한을 받는다
    t = Math.min(t, physMax);
    const capped = trueScale && t >= Math.min(physMax, CEIL) - 1e-6;
    t *= gain;
    t *= (o.scale == null ? 1 : o.scale);
    // 조절(자동 프레이밍·휠)은 물리 한계까지. 그 위에 호출부가 **화면 기준 상한**을
    // 얹을 수 있다(`fillMax`).
    // ⚠️⚠️ **상한을 `gain` 으로 낮추려 하지 말 것.** `t` 는 이미 `physMax` 에 붙어
    //   포화돼 있는 경우가 많아(자동 프레이밍이 영역을 꽉 채운 상태) gain 을 줄여도
    //   결과가 **한 픽셀도 안 변한다** — 실제로 갤러리 살롱에서 상한 0.49 를 걸었는데
    //   54.6% 가 그대로 나왔다. 상한은 t 자체에 걸어야 한다.
    const hardMax = o.fillMax != null ? Math.min(physMax, o.fillMax) : physMax;
    t = Math.max(0.02, Math.min(hardMax, t));

    const vh = t, uw = (A * t) / aspect;
    const cu = 0.5 + (o.dx || 0), cv = 0.5 + (o.dy || 0);
    const u0 = cu - uw / 2, u1 = cu + uw / 2;
    const v0 = cv - vh / 2, v1 = cv + vh / 2;
    const unit = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const px = unit.map(([u, v]) => {
      const w = H[6] * u + H[7] * v + H[8];
      return [(H[0] * u + H[1] * v + H[2]) / w, (H[3] * u + H[4] * v + H[5]) / w];
    });
    return { quad: px, trueScale, assumed, over, capped, heightRatio: t };
  }

  // ==========================================================================
  //  장면 조명 모델 — 방향 + **신뢰도** (브리핑: CONFIDENCE-AWARE RENDERING)
  // ==========================================================================
  // 브리핑: "If scene-light estimation is uncertain: apply LESS synthetic lighting,
  //          not more. UNCERTAINTY ↑ → SYNTHETIC EFFECT STRENGTH ↓"
  //
  // `scenes.json` 의 `lightDir` 은 신뢰도가 없다. 실측(scenelight.mjs, 2026-09-01):
  //     실내 7개   벽 낙차 21~96  → 방향이 사진에 실제로 찍혀 있다
  //     평면 벽 6개 벽 낙차 0~4.5 → **아무 방향도 없다**(흰 벽돌은 정확히 0.0)
  //   그런데 그 6개는 전부 손으로 적은 `[-1,-1]` 이었다. 즉 우리는 근거 없이
  //   45° 대각 광원을 **발명해** 액자 음영과 그림자를 그 방향으로 그려 왔다.
  //
  // ⚠️ 신뢰도로 줄이는 것은 **세기가 아니라 가로 성분**이다.
  //    · 가로(창이 어느 쪽인가)는 사진에서만 알 수 있다 → 모르면 0 으로 수렴시킨다.
  //    · 세로(위에서 온다)는 실내 조명의 보편 가정이라 신뢰도와 무관하게 유지한다
  //      (CLAUDE.md 39 가 이미 같은 이유로 세로를 항상 위로 고정했다).
  //    세기까지 줄이면 평면 벽 6개에서 액자가 통째로 납작해진다 — 그건 다른 결함이다.
  //    결과적으로 평면 벽에서는 광원이 **바로 위**가 되고 그림자도 곧게 아래로 진다
  //    (모르는 방향으로 비스듬히 드리우지 않는다 = 최소 주장).
  function sceneLightModel(scene) {
    if (!scene) return { dir: [-0.7071, -0.7071], conf: 0, wallLum: 0.6, grad: 0 };
    if (scene._lm) return scene._lm;
    const raw = scene.lightDir || [-1, -1];
    const rn = Math.hypot(raw[0], raw[1]) || 1;
    let conf = 0, wallLum = 0.6, grad = 0, measured = false;
    const q = scene.region || scene.opening;
    if (scene.img && scene.loaded && q) {
      try {
        const iw = scene.img.naturalWidth, ih = scene.img.naturalHeight;
        const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        // 영역을 35% 넓혀 **주변 벽**까지 본다 — 작품이 덮을 자리 밖의 빛을 읽어야 한다
        const ex = (x1 - x0) * 0.35, ey = (y1 - y0) * 0.35;
        const rx0 = Math.max(0, x0 - ex), rx1 = Math.min(1, x1 + ex);
        const ry0 = Math.max(0, y0 - ey), ry1 = Math.min(1, y1 + ey);
        const N = 7;   // 7×7 이면 벽 무늬는 평균으로 사라지고 넓은 낙차만 남는다
        const c = document.createElement('canvas');
        c.width = N; c.height = N;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(scene.img, rx0 * iw, ry0 * ih, (rx1 - rx0) * iw, (ry1 - ry0) * ih, 0, 0, N, N);
        const d = cx.getImageData(0, 0, N, N).data;
        let mean = 0, gx = 0, gy = 0, ss = 0;
        const L = [];
        for (let i = 0; i < N * N; i++) {
          L.push((d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) / 255);
          mean += L[i];
        }
        mean /= N * N;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const u = x - (N - 1) / 2, v = y - (N - 1) / 2;
          gx += u * L[y * N + x]; gy += v * L[y * N + x]; ss += u * u;
        }
        gx /= ss; gy /= ss;
        wallLum = mean;
        grad = Math.hypot(gx, gy) * (N - 1) * 255;      // 영역 전체에 걸친 밝기 낙차(레벨)
        measured = true;
      } catch (e) { /* taint 등 — 신뢰도 0 으로 남는다(= 보수적) */ }
    }
    // 낙차 4 미만은 측정 잡음이다(실측: 흰 벽돌 0.0 · 콘크리트 1.8). 22 위면 확실하다.
    conf = Math.max(0, Math.min(1, (grad - 4) / 18));
    // ⚠️ **가로 성분을 0 까지 죽이지 말 것 — 완벽한 좌우 대칭 자체가 CG 신호다.**
    //   처음엔 `x *= conf` 로 평면 벽 6개를 **정확히 수직광**으로 만들었는데, 그러면
    //   좌우 살이 한 치도 다르지 않고 캔버스 랩의 양 옆면이 똑같이 어두워진다
    //   (실측 t07: 왼쪽 옆면 배율 0.91 → 0.79 로 떨어져 세로 검은 띠로 보였다).
    //   실제 실내 사진에 완전한 수직광은 없다. 모르면 **주장을 약하게** 할 뿐,
    //   있지도 않은 대칭을 만들지는 않는다 — 40% 를 바닥으로 남긴다(≈수직에서 22°).
    const x = (raw[0] / rn) * (0.40 + 0.60 * conf);
    const y = Math.min(-0.35, raw[1] / rn);            // 언제나 위에서 (보편 가정)
    const m = Math.hypot(x, y) || 1;
    const lm = { dir: [x / m, y / m], conf, wallLum, grad, measured };
    if (scene.loaded) scene._lm = lm;
    return lm;
  }

  // 사진에서 구멍 주변 평균색을 읽어 조명 톤을 추정 (taint 되면 null)
  function sampleTone(img, quad) {
    try {
      const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const x = c.getContext('2d', { willReadFrequently: true });
      // 구멍 바깥 테두리(액자와 벽)를 읽는다 — 구멍 안은 어차피 우리가 덮는다
      const px = Math.max(0, (x0 - (x1 - x0) * 0.25) * iw);
      const py = Math.max(0, (y0 - (y1 - y0) * 0.25) * ih);
      const pw = Math.min(iw - px, (x1 - x0) * 1.5 * iw);
      const ph = Math.min(ih - py, (y1 - y0) * 1.5 * ih);
      if (pw < 2 || ph < 2) return null;
      x.drawImage(img, px, py, pw, ph, 0, 0, 1, 1);
      const d = x.getImageData(0, 0, 1, 1).data;
      return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255 };
    } catch (e) { return null; }
  }

  /**
   * 장면 위에 작품을 끼워 ctx 에 그린다.
   * @returns {quad:[[x,y]×4]} 화면 픽셀 quad (드래그 히트테스트용) 또는 null
   */
  function composeScene(ctx, W, H, scene, art, ui) {
    if (!scene || !scene.img || !scene.loaded || !art) return null;
    const u = ui || {};
    const aw0 = art.naturalWidth || art.width, ah0 = art.naturalHeight || art.height;

    // 이 장면에서 작품이 어디에 얼마나 크게 앉는지 계산한다(주어진 프레이밍 기준)
    // adj 를 따로 받는 이유 — 자동 프레이밍은 **사용자 조절 전(중립) 배치**로 정해야 한다(아래).
    const solve = (fit, adj) => {
      const a = adj || {};
      if (scene.region) {
        const p = placeInRegion(mapQuad(scene.region, fit), {
          regionAspect: scene.regionAspect,
          regionCm: scene.regionCm,
          artCm: u.artCm,
          artAspect: aw0 / ah0,
          fill: scene.fill,
          gain: a.gain, fillMax: a.fillMax,
          scale: a.scale, dx: a.dx, dy: a.dy,
        });
        if (!p) return null;
        p.regionPx = quadSize(mapQuad(scene.region, fit));   // 드래그 환산용
        return { quad: p.quad, place: p };
      }
      if (scene.opening) return { quad: mapQuad(scene.opening, fit), place: null };
      return null;
    };
    const userAdj = { scale: u.scale, dx: u.dx, dy: u.dy };

    // ── 자동 프레이밍 — 작품이 작으면 **카메라가 다가간다** ────────────────────
    // 실치수를 지키면 4호 소품(24×33cm)은 3m 벽에서 손톱만 해진다. 정직하지만
    // 홍보 이미지로는 못 쓴다. 그렇다고 작품을 키우면 크기가 거짓말이 된다.
    // 사진가가 하는 대로 **화면을 좁힌다** — 방도 같이 커지므로 비례는 그대로다.
    // ⚠️ 확대는 원본 픽셀을 넘어서면 뭉개진다. 상한을 두고, 출력 해상도도 함께 낮춘다
    //    (호출부가 `maxSrcScale` 로 알려준다).
    // ⚠️ **자동 프레이밍은 사용자 조절(휠 확대·드래그)에 반응하면 안 된다.**
    //    예전엔 조절 후 배치를 보고 배율을 다시 정해서, 휠로 작품을 키우면 배경이
    //    거꾸로 줄어들었다("배경이 같이 움직인다", 2026-08-30 신고). 중립 배치로만 정한다.
    let fit = fitScene(scene.img, W, H, scene.focus, 1);
    const neutral = solve(fit, null);
    if (!neutral) return null;

    // ⚠️ **목표는 높이가 아니라 '화면에서 차지하는 면적'이다** (2026-08-30).
    //   예전엔 "작품 높이가 화면의 52%"였는데, 세로 작품(4:5)이면 그래도 면적은 21% 뿐이다.
    //   실측: 우리 10케이스 중앙값 **16.9%**, FrameIt Pro 결과물은 **44.1%**. 그래서
    //   "액자가 아니라 벽이 먼저 보이는" 사진이 됐다. 면적으로 잡으면 가로·세로·정사각이
    //   모두 같은 존재감을 갖는다.
    const areaOf = (q) => { const s = quadSize(q); return (s.w * s.h) / (W * H); };
    let zoom = 1, gain = 1, enlarged = 1, fillMax = null;
    if (u.autoFrame !== false) {
      const wantA = u.frameArea == null ? 0.44 : u.frameArea;
      // ── 최소 크기 (2026-08-31 신고) ────────────────────────────────────────
      // 실치수는 정직하지만 **홍보 이미지에서 작품이 안 보이면 쓸모가 없다.**
      // 실측(minsize.mjs, 갤러리 살롱): 4호 1.43% · 짧은 변 113px/1080. 실서버에는
      // **12×12cm** 짜리 소품도 있어 그대로 걸면 0.2%(≈40px) — 점이 된다.
      // 그렇다고 늘 채우면 12cm 와 162cm 가 같아져 실치수 기능이 죽는다.
      //
      // ⚠️⚠️ **딱딱한 바닥(clamp)으로 두지 말 것.** 처음에 `7% 미만이면 7% 로` 를 넣었더니
      //   갤러리 살롱에서 **12cm·24cm·31cm·45cm·60cm 가 전부 7.00%** 로 붙어 버렸다
      //   (실측 minsize.mjs) — 소품끼리 크기 차이가 통째로 사라져, 고치려던 기능을
      //   그 구간에서 죽인 셈이다. 그래서 **무릎(soft knee)** 으로 둔다:
      //     reach ≥ KNEE  → 손대지 않는다(예전 그대로 정직한 비율)
      //     reach < KNEE  → [0,KNEE] 를 [FLOOR,KNEE] 로 **선형 사상**한다
      //   순서는 그대로 보존되고 바닥만 들린다. KNEE 에서 값이 이어지므로 단차도 없다.
      // ⚠️⚠️ **무릎을 '화면 절대 면적'으로 고정하지 말 것 — 실내 장면에서 전 구간을 삼킨다.**
      //   실내는 `maxLong` 0.49 라 조각이 화면 면적의 24% 를 넘을 수 없는데 KNEE 가 11% 였다.
      //   즉 12cm 소품부터 100호까지 **전부** 보정 구간 안에 들어가, [0,KNEE] → [FLOOR,KNEE]
      //   사상이 실치수를 통째로 절반으로 압축했다. 실측(2026-09-03 신고, minsize.mjs):
      //   컬렉터 살롱에서 12×12cm 이 화면 긴변 27.1% · 130×162cm 이 38.2% —
      //   **실치수 13.5배 차이가 화면에서 1.41배**가 됐다(평면 벽은 2.3배로 멀쩡했다).
      //   방에는 소파·콘솔이 함께 찍혀 있어 크기 기준이 눈에 보이므로, 그 압축이
      //   평면 벽과 달리 **바로 '너무 크다'로 읽힌다**.
      //   그 장면이 보여 줄 수 있는 최대 면적에 비례시켜 무릎이 어느 장면에서나 같은
      //   **상대 위치**에 오게 한다(평면 벽 maxLong 0.70 에서는 기존 값 그대로다).
      const _mlKnee = u.maxLongFrac != null ? u.maxLongFrac
        : (scene.maxLong == null ? 0.70 : scene.maxLong);
      const _kneeK = Math.min(1, Math.pow(_mlKnee / 0.70, 2));
      const KNEE = u.minArea == null ? 0.11 * _kneeK : u.minArea;      // 이 위로는 무보정
      const FLOOR = u.floorArea == null ? 0.055 * _kneeK : u.floorArea; // 아무리 작아도 이만큼은
      const a0 = areaOf(neutral.quad);
      // ① 먼저 **영역 안에서** 키운다 — 카메라를 안 건드리므로 벽 화질 손실이 0이다.
      //    ⚠️ **실치수를 아는 작품에는 쓰지 않는다** — 벽 대비 비율이 곧 정직한 치수라
      //    여기에 배수를 곱하면 30호가 100호처럼 보인다. 그런 작품은 ②카메라만 쓴다.
      // 가정 크기(치수 미입력)도 `gain` 에서 제외한다 — 배수를 곱하면 그 가정마저
      // 무의미해지고 다시 화면 상한까지 커진다(그게 이 신고의 원인이었다).
      const honest = !!(neutral.place && (neutral.place.trueScale || neutral.place.assumed));
      if (a0 > 1e-4 && a0 < wantA && scene.region && !honest) {
        const g = Math.sqrt(wantA / a0);
        if (solve(fit, { gain: g })) gain = g;   // 영역 밖으론 placeInRegion 이 알아서 막는다
      }
      // ② 남은 부족분만 카메라를 당겨 채운다.
      const cur = areaOf((solve(fit, { gain }) || neutral).quad);
      if (cur > 1e-4 && cur < wantA) {
        const iw = scene.img.naturalWidth, ih = scene.img.naturalHeight;
        const base = Math.max(W / iw, H / ih);
        // 원본을 이 이상 늘리지 않는다(기본 1.15배). 여기가 '끝까지 확대하면 깨진다'의 방어선
        // ⚠️ 다만 **바닥에 못 미치는 작품에서는 조금 더 허용한다** — 배경을 조금 무르게
        //   하는 값으로 작품을 부풀리지 않을 수 있으면 그쪽이 낫다(비례는 거짓말하지 않는다).
        //   소품 근접 촬영의 배경이 무른 건 결함이 아니라 실제 사진의 모습이기도 하다.
        const small = cur * 2.6 * 2.6 < KNEE;
        const maxSrc = (u.maxSrcScale == null ? 1.15 : u.maxSrcScale) * (small ? 1.25 : 1);
        const zoomCap = Math.max(1, maxSrc / base);
        // ⚠️ **영역 상한에 걸린 작품은 카메라로 되감지 말 것.** 상한을 둬서 벽 여백을
        //   만들어 놨는데 자동 프레이밍이 44% 를 채우려고 다시 당기면, 잘라낸 만큼
        //   화면이 좁아져 **원래대로 '벽을 꽉 채운' 그림**이 된다. 큰 작품은 여백을
        //   보여 주는 게 목적이므로 여기서 멈춘다.
        zoom = Math.max(1, Math.min(Math.sqrt(wantA / cur), zoomCap, small ? 3.0 : 2.6));
      }
      // ③ 카메라를 끝까지 당기고도 무릎에 못 미치면 — **그때만** 실치수를 벗어난다.
      //    소품은 원본 사진에서 차지하는 픽셀 자체가 몇십 개라 확대로는 절대 못 채운다
      //    (12×12cm 을 갤러리 살롱에 걸면 화면의 0.2% = 짧은 변 40px).
      if (honest && scene.region) {
        const reach = areaOf((solve(fit, { gain }) || neutral).quad) * zoom * zoom;
        if (reach > 1e-6 && reach < KNEE) {
          const want = FLOOR + (KNEE - FLOOR) * (reach / KNEE);   // 순서 보존 · KNEE 에서 연속
          const g = Math.sqrt(want / reach);
          if (g > 1 && solve(fit, { gain: gain * g })) gain *= g;
        }
      }
      // ── 화면 기준 절대 상한 — 조각의 **긴 변**이 화면의 이 비율을 넘지 않는다 ─────────
      // ⚠️ 영역(벽) 상한만으로는 부족하다. 자동 프레이밍이 목표 면적을 채우려고 카메라를
      //    다시 당기면 화면에서는 그대로 커진다 — 실측: 벽 영역을 70% 로 묶었는데도
      //    화면 긴변이 **74.9%** 였다(치수 미입력 작품, 흰 벽돌). 사용자가 보는 건 화면이다.
      {
        // 장면마다 다르다 — **실내 사진은 더 작게**. 평면 매크로 벽은 벽면만 크게 찍은
        // 사진이라 작품이 화면의 70% 를 차지해도 '벽에 걸린 그림'으로 읽히지만,
        // 방이 통째로 보이는 실내 사진에서 같은 비율이면 **벽 한 면을 삼킨 크기**가 된다.
        // (2026-08-31 요청: 실내는 지금의 0.7 배로)
        const MAXLONG = u.maxLongFrac != null ? u.maxLongFrac
          : (scene.maxLong == null ? 0.70 : scene.maxLong);
        const cap = MAXLONG * Math.max(W, H);
        // ⚠️ **`quadSize` 로 재지 말 것 — 그건 마주보는 변의 평균이다.** 원근이 있는 실내
        //    장면에서는 화면에 실제로 차지하는 **바운딩 박스**가 그보다 크다. 실측(갤러리
        //    살롱): 상한을 0.49 로 걸었는데 결과가 54.6% 였다. 계측 훅(`artlookProbe`)도,
        //    사용자 눈도 바운딩 박스를 본다 — 같은 것으로 재야 한다.
        const s0 = solve(fit, { gain }) || neutral;                     // zoom=1 기준
        const q0 = s0.quad;
        const xs0 = q0.map((p) => p[0]), ys0 = q0.map((p) => p[1]);
        const long0 = Math.max(Math.max(...xs0) - Math.min(...xs0),
                               Math.max(...ys0) - Math.min(...ys0));
        if (long0 > 1e-6) {
          zoom = Math.max(1, Math.min(zoom, cap / long0));
          // zoom 을 1 까지 내려도 넘치면 **영역 안에서** 줄인다(카메라로는 더 못 줄인다).
          // 줄이는 건 `gain` 이 아니라 `fillMax` 다 — 위 주석 참고.
          if (long0 > cap && s0.place && s0.place.heightRatio > 0) {
            fillMax = s0.place.heightRatio * (cap / long0);
          }
        }
      }
      if (zoom > 1.02) {
        const nq = (solve(fit, { gain, fillMax }) || neutral).quad;
        const cx = nq.reduce((s, p) => s + p[0], 0) / 4;
        const cy = nq.reduce((s, p) => s + p[1], 0) / 4;
        const focus = [(cx - fit.dx) / fit.sw, (cy - fit.dy) / fit.sh];
        fit = fitScene(scene.img, W, H, focus, zoom);
      }
      // 얼마나 부풀렸나 — **추정하지 말고 결과에서 잰다**(placeInRegion 이 영역 밖으로
      // 못 나가게 다시 깎으므로, gain 을 그대로 쓰면 실제보다 크게 보고하게 된다).
      if (honest) {
        const got0 = areaOf((solve(fit, { gain, fillMax }) || neutral).quad);
        const hon0 = areaOf((solve(fit, null) || neutral).quad);
        if (hon0 > 1e-9) enlarged = Math.sqrt(got0 / hon0);
      }
    }
    // 프레이밍(gain·zoom)이 정해진 뒤에 사용자 조절을 얹는다
    let got = solve(fit, Object.assign({ gain, fillMax }, userAdj));
    if (!got) return null;

    const dbg = u.debug ? {} : null;
    ctx.drawImage(scene.img, fit.dx, fit.dy, fit.sw, fit.sh);
    // ── 벽 진정(wallCalm) — 배경의 결만 죽이고 조명 낙차는 남긴다 ────────────────
    // 실측(2026-08-30): 우리 벽 사진의 결 세기(1200px 기준 band-pass std)가
    //   beige-plaster 15.6 · stone 14.5 · travertine 12.4 … 인데 FrameIt 의 기준 벽은 **2.8** 이다.
    // 그래서 "액자보다 벽이 먼저 보이는" 사진이 됐다(사용자 지적 A).
    //
    // ⚠️ **반드시 화면 전체에 균일하게 걸 것.** 액자 둘레만 흐리면 그게 곧 마스크 테·헤일로다.
    //    같은 사진의 흐린 판을 알파로 덮으면 `원본×(1−c) + 흐림×c` 가 되어,
    //    2~8px 결은 지워지고 12px 이상의 조명 그라디언트는 그대로 남는다(= 언샤프의 역).
    // ⚠️ 조각은 이 다음에 그리므로 **작품·액자는 흐려지지 않는다**. 전경(fgImg)도 뒤에 그린다.
    const calm = u.wallCalm != null ? u.wallCalm : (scene.wallCalm == null ? 0 : scene.wallCalm);
    if (calm > 0.02 && typeof ctx.filter === 'string') {
      const r = Math.max(1.5, Math.max(W, H) * 0.004);
      ctx.save();
      ctx.filter = `blur(${r.toFixed(2)}px)`;
      ctx.globalAlpha = Math.min(0.92, calm);
      // 흐린 판이 화면 밖에서 비어 보이지 않게 살짝 넘겨 그린다(가장자리 투명 혼입 방지)
      const o2 = r * 3;
      ctx.drawImage(scene.img, fit.dx - o2, fit.dy - o2, fit.sw + o2 * 2, fit.sh + o2 * 2);
      ctx.restore();
      ctx.filter = 'none';
    }
    const quad = got.quad, place = got.place;
    const size = quadSize(quad);
    if (!(size.w > 4 && size.h > 4)) return null;

    // 판 해상도 — 구멍보다 크게(축소 샘플링이 화질에 유리) 하되 상한을 둔다.
    // ⚠️ **상한을 걸 때 비율을 반드시 유지할 것.** 예전엔 가로·세로에 각각 `min(cap, …)` 을
    //    걸어서, 큰 작품에서 한쪽만 잘리면 판이 정사각형이 됐다. 그러면 작품이 contain 되어
    //    좌우에 검은 여백이 생기고, 그 검은 띠가 옆면 텍스처로도 뽑혀 **작품 오른쪽에 검은
    //    막대가 붙었다**(휠로 키우면 나타남, 2026-08-30 신고).
    const ss = Math.min(2, Math.max(1, (u.supersample == null ? 1.6 : u.supersample)));
    const cap = 2400;
    const kCap = Math.min(1, cap / Math.max(size.w * ss, size.h * ss));
    const iw = Math.max(8, Math.round(size.w * ss * kCap));
    const ih = Math.max(8, Math.round(size.h * ss * kCap));

    // ── 실제 치수(cm) 기반 매트 폭 ────────────────────────────────────────
    // 경쟁 앱 리뷰의 최다 불만이 "방마다 크기가 제각각", "새 치수를 안 보여준다"다.
    // 장면이 구멍의 실치수를 선언하고 작품 실치수를 알면, 매트가 그 차이를 먹어
    // **같은 방에서 30호와 100호가 다르게 보인다**(정직한 스케일).
    let matAuto = null, fitNote = null;
    if (scene.opening && scene.openingCm && u.artCm && u.artCm[0] > 0 && u.artCm[1] > 0) {
      const [ow, oh] = scene.openingCm, [awCm, ahCm] = u.artCm;
      const need = Math.max(awCm / ow, ahCm / oh);
      if (need <= 1) {
        // 작품이 구멍 안에 들어간다 → 남는 자리를 매트가 먹는다(=정직한 스케일)
        matAuto = Math.max(0, Math.min(0.35, Math.min(1 - awCm / ow, 1 - ahCm / oh) / 2));
        fitNote = { ok: true, artCm: [awCm, ahCm], openingCm: [ow, oh] };
      } else {
        // 이 액자보다 큰 작품 — 숨기지 말고 알린다(다른 장면을 고르게)
        fitNote = { ok: false, artCm: [awCm, ahCm], openingCm: [ow, oh], over: need };
      }
    } else if (place) {
      fitNote = { ok: !place.over, artCm: u.artCm || null, trueScale: place.trueScale, over: place.over };
    }
    // enlarged > 1 = 최소 크기를 지키려고 실치수보다 크게 걸었다는 뜻. 숨기지 말고 알린다 —
    // 실치수가 이 기능의 약속이라, 말없이 부풀리면 그 약속이 조용히 깨진다.
    if (fitNote) { fitNote.zoom = zoom; fitNote.enlarged = enlarged; }

    const matDefault = matAuto != null ? matAuto
      : (scene.region ? 0 : (scene.mat == null ? 0.06 : scene.mat));
    const ins = buildInsert(art, {
      W: iw, H: ih,
      mat: u.mat == null ? matDefault : u.mat,
      matColor: u.matColor || scene.matColor || '#f4f1ea',
      bevel: u.bevel !== false,
      innerShadow: u.innerShadow != null ? u.innerShadow
        : (scene.innerShadow == null ? 0.22 : scene.innerShadow),
      glass: u.glass == null ? (scene.glass || 0) : u.glass,
      lightDir: sceneLightModel(scene).dir,
      canvasTexture: !!u.canvasTexture,
      backing: !!scene.opening,   // 액자 구멍 안에서만 뒤판을 깐다
    });

    // 조명 톤 / 기준 밝기 — 작품이 놓일 자리 **주변 벽**을 실제로 읽는다.
    // ⚠️ 기준 밝기를 고정값(0.5)으로 두면 **흰 벽에서 작품이 통째로 밝아져 뿌예진다**
    //    (화이트 브릭에서 1.18배 부양, 실측). 벽이 밝으면 기준도 밝아야 상쇄된다.
    //    region 장면은 `opening` 이 없으므로 둘 중 있는 쪽을 쓴다 — 예전엔 undefined 라
    //    항상 기본값으로 떨어졌다.
    const sampleQuad = scene.region || scene.opening;
    const wallSample = sampleTone(scene.img, sampleQuad);
    const tone = scene.tone || (wallSample
      ? [wallSample.r, wallSample.g, wallSample.b] : [0.5, 0.5, 0.5]);
    const wallRef = wallSample
      ? (0.2126 * wallSample.r + 0.7152 * wallSample.g + 0.0722 * wallSample.b) : 0.6;
    // ── 벽에 지는 그림자 (사진에 액자가 없는 '캔버스만' 장면용) ────────────────
    // 조사에서 확인된 3중 그림자 중 사진이 못 주는 둘을 여기서 만든다.
    //   ① 접지(contact): 아주 좁고 진하다 — 작품이 벽에 닿아 있다는 신호
    //   ② 투영(cast)  : 방의 광원 반대쪽으로 넓고 옅게
    // 액자가 사진에 이미 있는 장면(frameless=false)은 그림자도 사진에 구워져 있으므로 건너뛴다.
    // ── 두께 — 작품은 벽에서 떠 있는 상자다 (사진에 액자가 없는 장면에서만) ──────
    // 사진에 이미 액자가 있는 장면은 그 액자가 제 두께·그림자를 갖고 있으므로 건드리지 않는다.
    const depth = scene.frameless
      ? (u.depth == null ? (scene.depth == null ? 0.055 : scene.depth) : u.depth) : 0;
    const box = boxFaces(quad, { depth, // ⚠️ **빛을 받는 옆면이 보이게 둘 것.** 예전 [-0.58,-0.32] 는 오른쪽·아래 면을 보여
    //   줬는데, 조명이 좌상단이라 그 두 면이 **둘 다 그늘**이었다 — 두께가 어두운 띠로만
    //   읽혀 아무 도움이 안 됐다. FrameIt 의 캔버스랩도 **왼쪽·위** 면이 보인다
    //   (실측: 그쪽 단면 낙차 42~59, 반대쪽은 5~8).
    view: scene.view || [0.58, 0.32], persp: scene.persp });
    // ⚠️ **광원은 한 곳에서만 온다** (브리핑 5번: 같은 방·같은 카메라).
    //    옛 코드는 `scene.lightDir` 을 날것으로 썼는데, 그 값의 절반은 근거 없이 손으로
    //    적은 `[-1,-1]` 이었다. 신뢰도 모델을 통과시켜 **측정된 만큼만** 방향을 준다.
    const lm = sceneLightModel(scene);
    const ld = lm.dir;
    // ⚠️ **그림자 길이는 lightDir 을 어떻게 적었는지에 좌우되면 안 된다.**
    //   scenes.json 은 절반이 `[-1,-1]`(크기 1.414), 절반이 측정값 `[0.78,-0.63]`(크기 1)
    //   이라, 정규화하지 않으면 앞쪽 7개 장면의 그림자가 이유 없이 **41% 더 길었다**.
    //   브리핑 5번 "같은 방에서 같은 카메라" — 방향만 장면마다 다르고 나머지는 공통이다.
    const ldMag = Math.hypot(ld[0], ld[1]) || 1;
    const ldn = [ld[0] / ldMag, ld[1] / ldMag];

    if (scene.frameless) {
      // 그림자는 **벽에 닿은 뒷면** 기준이다. 앞면 기준으로 그리면 두께만큼 어긋나 뜬다.
      // u.shadow 로 덮어쓸 수 있다 — 디버그에서 그림자만 꺼 보려면 필요하다(브리핑 9번)
      const sa = u.shadow != null ? u.shadow : (scene.shadow == null ? 1 : scene.shadow);
      const off = Math.max(size.w, size.h);
      // 두께가 있으면 그림자도 그만큼 길어진다(물리적으로 맞고, 눈에도 그렇게 읽힌다)
      const k0 = 1 + depth * 4;
      // 두 겹: 넓고 옅은 투영 + 좁고 진한 접지. 접지가 없으면 벽에 '떠' 보이고,
      // 투영이 없으면 스티커처럼 납작해진다. 경쟁사 결과물도 이 두 겹이다.
      //
      // ⚠️⚠️ **그림자를 본 캔버스에 바로 fill 하지 말 것.** Canvas 그림자는 도형을
      //   같이 칠하므로, `fill()` 이 quad 를 **통짜 검정**으로 덮는다. 그 위에 워프된
      //   판을 얹으면 판의 가장자리 AA 픽셀(알파 0.5)이 검정과 섞여 조각 둘레에
      //   **1px 검은 테**가 생긴다 — 잘라 붙인 티의 가장 큰 원인이었다.
      //   (실측 2026-08-30: 살 밝기 167 × 0.5 = 83, 다음 픽셀 167 × 0.7 = 117. 정확히 일치)
      //   해법은 **도형을 화면 밖에 두고 그림자만 끌어오는 것**이다 — 캐스터를 캔버스
      //   왼쪽 바깥(−2W)으로 옮기고 shadowOffsetX 에 2W 를 더한다. 도형 자체는 아무 데도
      //   안 찍히고 그림자만 제자리에 남는다. 검은 심도, 잘라낸 자국도 없다.
      //
      //   ⚠️ **파내기(destination-out)로 해결하려 하지 말 것.** 조각이 덮을 자리를
      //   파내면 이번엔 조각 둘레에 **그림자가 없는 밝은 띠**가 생긴다 — 파냄은 실루엣보다
      //   조금 크게 해야 검은 테가 안 남는데, 그만큼이 곧 밝은 테가 된다
      //   (실측 2026-08-30: 벽 177 인데 경계 바로 밖이 217. 검은 테를 밝은 테로 바꿨을 뿐).
      const path = (cx, q, dx) => {
        cx.beginPath();
        cx.moveTo(q[0][0] + dx, q[0][1]);
        for (let i = 1; i < 4; i++) cx.lineTo(q[i][0] + dx, q[i][1]);
        cx.closePath();
      };
      // ⚠️ **접지를 진하게 만들지 말 것.** 같은 흰 벽돌벽에서 FrameIt 은 벽 밝기를
      //   18~22 레벨만 떨어뜨리는데 우리는 73 이었다(실측 2026-08-30). 진한 접지선은
      //   '벽에 닿았다'가 아니라 **오려 붙였다**로 읽힌다. 넓고 옅은 투영이 주역이고
      //   접지는 거들 뿐이다.
      const AWAY = 2 * W + off;                 // 캔버스 밖으로 충분히 (블러 반경보다 멀리)
      ctx.save();
      // ── 세 겹: 넓은 반그림자 · 투영 · 접지 ──────────────────────────────────
      // ⚠️ **한 겹 가우시안으로 끝내지 말 것.** 실제 그림자는 세 성분이 겹친 것이고,
      //    겹마다 폭·세기·방향 오프셋이 다르다. 두 겹만 썼을 때 실측한 감쇠 곡선은
      //    가까이는 골든과 같은데(1% 지점 0.36~0.45 vs 골든 0.26~0.75) **꼬리가 일찍
      //    죽었다**(8% 지점 0.02~0.06 vs 골든 0.10~0.12). 그래서 벽으로 부드럽게 퍼지는
      //    느낌이 없고 조각 둘레에만 그림자가 붙은 것처럼 보였다.
      //    ⚠️ 겹을 더할 땐 **가까운 쪽 총량이 늘지 않게** 주 투영을 그만큼 줄일 것 —
      //    안 그러면 접지가 진해져 '오려 붙인 티'로 되돌아간다(2차 라운드 교훈).
      // ⚠️⚠️ **블러가 오프셋보다 크면 그건 그림자가 아니라 헤일로다** (2026-08-31).
      //    예전 값은 반그림자 블러 0.160 에 오프셋 0.057, 투영 블러 0.050 에 오프셋 0.030
      //    — 둘 다 **번지는 폭이 밀려난 거리보다 넓어** 조각 사방에 균일한 회색 테가 남았다.
      //    벽에 거의 붙은 액자는 두께 이상으로 그림자를 만들 수 없고, 광원 쪽에는 아예
      //    없어야 한다. 실측(physics.py 사방 그림자 세기의 max/min):
      //        골든 3.5~71.1(중앙 16.2)  ↔  우리 3.7~10.3(중앙 5.6)
      //    그래서 **오프셋 > 블러** 가 되게 뒤집는다. 가까운 쪽(경계 1%) 총량은
      //    0.216 → 0.214 로 그대로 두고(접지가 진해지면 '오려 붙인 티'로 되돌아간다),
      //    광원 쪽만 0.024 → 0.002 로 걷어낸다. 즉 **더 진하게 만드는 변경이 아니다.**
      //  · penumbra 는 여전히 필요하다 — 없애면 꼬리가 죽어 벽으로 퍼지는 느낌이 사라진다
      //    (4차 라운드에서 확인). 폭을 줄이고 **밀어내서** 한쪽으로만 퍼지게 한다.
      //  · contact 는 건드리지 않는다. 액자와 벽이 맞닿은 **틈의 폐색**이라 사방에 조금씩
      //    있는 게 맞고(브리핑 1-A), 여기를 키우면 곧바로 '오려 붙였다'로 읽힌다.
      // ⚠️⚠️ **넓은 반그림자(penumbra)는 뺐다** (2026-08-31). 방향을 줘도 그건 결국
      //   조각을 둘러싼 **회색 헤일로**로 읽혔다 — "generic drop shadow 처럼 보인다"는
      //   지적의 실체. 벽에 거의 붙은 액자가 만들 수 있는 그림자는 두 개뿐이다.
      //     A 접지 : 벽과 닿은 자리. 짧고 가장 또렷하다.
      //     B 투영 : 광원 반대쪽으로. **접지보다 훨씬 약하고** 부드럽다.
      //   가까운 쪽 총량도 0.21 → 0.08 로 줄였다 — 이번 라운드의 목표는 효과를 더하는
      //   게 아니라 **덜어내는 것**이다("아무것도 안 한 것처럼 자연스러운가").
      //           [블러(off 대비), 알파, 오프셋 배수, 이름]
      // ⚠️ **투영(cast)만 장면 광원 신뢰도로 줄인다** (브리핑 "CAST SHADOW: only create if
      //   scene lighting provides a credible directional source"). 평면 매크로 벽 6개는
      //   벽 낙차가 0~4.5 라 **방향광의 증거가 없다** — 거기에 또렷한 방향 투영을 그리는 건
      //   근거 없는 발명이다.
      //   ⚠️ 다만 **없애지는 않는다.** 벽에 걸린 액자는 어떤 빛에서도 그림자를 만든다 —
      //     지우면 곧바로 '오려 붙였다'로 되돌아간다(4·7차에서 반복 확인). 방향은 이미
      //     `sceneLightModel` 이 바로 위로 수렴시켰으므로, 여기서는 **세기만** 눅인다.
      //   ⚠️ 접지(contact)는 건드리지 않는다 — 벽과 맞닿은 **틈의 폐색**이라 광원과 무관하다.
      // ⚠️⚠️ **세기까지 줄이는 건 시도했다가 되돌렸다** (2026-09-01). 신뢰도로 투영 알파를
      //   0.70~1.00 배 했더니 `contact_drop` 이 전 케이스에서 내려갔고(t01 39.9→36.9,
      //   t07 19.9→17.6 로 밴드 밖) `recover_pct` 도 같이 떨어졌다. **얻는 게 없었다** —
      //   근거 없는 방향을 그리는 문제는 이미 `sceneLightModel` 이 방향을 바로 위로
      //   수렴시켜 해결했고, 여기서 세기를 더 깎는 건 '효과를 약하게' 할 뿐 '합성을 줄이는'
      //   게 아니다. 브리핑의 Pareto 규칙대로 되돌린다. 방향 = 신뢰도, 세기 = 물리.
      const LAYERS = [[0.045, 0.060, 2.20, 'cast'],      // 아주 부드러운 투영
                      [0.012, 0.195, 0.16, 'contact']];  // 접지(짧고 또렷)
      // 디버그: 겹마다 따로도 그려 둔다 — **같은 배열·같은 코드**를 쓰므로 화면과 어긋날 수 없다
      if (u.debug) {
        dbg.shadow = {};
        for (const [blur, alpha, k, name] of LAYERS) {
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const cx = c.getContext('2d');
          cx.shadowColor = `rgba(0,0,0,${alpha * sa})`;
          cx.shadowBlur = off * blur * k0;
          cx.shadowOffsetX = -ldn[0] * off * 0.030 * k * k0 + AWAY;
          cx.shadowOffsetY = -ldn[1] * off * 0.034 * k * k0;
          cx.fillStyle = '#000';
          path(cx, quad, -AWAY);
          cx.fill();
          dbg.shadow[name] = c;
        }
      }
      for (const [blur, alpha, k] of LAYERS) {
        ctx.shadowColor = `rgba(0,0,0,${alpha * sa})`;
        ctx.shadowBlur = off * blur * k0;
        ctx.shadowOffsetX = -ldn[0] * off * 0.030 * k * k0 + AWAY;
        ctx.shadowOffsetY = -ldn[1] * off * 0.034 * k * k0;
        ctx.fillStyle = '#000';
        path(ctx, quad, -AWAY);
        ctx.fill();
      }
      ctx.restore();
    }

    const lightOpts = {
      tone,
      toneAmt: scene.toneAmt == null ? 0.18 : scene.toneAmt,
      // 벽 명암 통과 — 장면사진과 그 fit 을 그대로 넘겨 셰이더가 같은 자리를 읽는다
      sceneImg: scene.img, sceneKey: scene.src, fit,
      wallAmt: u.wallAmt == null ? (scene.wallAmt == null ? 0.5 : scene.wallAmt) : u.wallAmt,
      wallRef,
      wallLod: scene.wallLod,
      // 합성 해상도가 출력보다 크면(supersample) 축소하면서 잡음이 옅어진다 — 미리 키워 둔다
      grain: (scene.grain == null ? 0.012 : scene.grain) * (u.grainScale > 0 ? u.grainScale : 1),
    };
    const baseExp = scene.exposure == null ? 1 : scene.exposure;

    // ── 옆면 먼저 (앞면 뒤에 있다) ──────────────────────────────────────────
    // 광원을 향한 면은 밝고 등진 면은 어둡다. 이 명암 차이가 곧 '두께가 있다'는 신호다.
    const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
    for (const s of box.sides) {
      const n = SIDE_N[s.name];
      // lightDir 은 '빛이 **오는** 방향'(예: [-1,-1] 좌상단)이므로, 면 법선과 내적이
      // 크면 밝다. ⚠️ 예전엔 부호가 뒤집혀 있어서(-(n·ld)) 좌상단 조명인데 **아래·오른쪽
      //   옆면이 밝게** 칠해졌다 — 그림자는 오른쪽 아래로 지는데 그쪽 면이 밝으니
      //   두께가 거꾸로 읽혔다(2026-08-30 캔버스랩 실측에서 드러남).
      const lit = (n[0] * ld[0] + n[1] * ld[1]) / Math.max(1e-6, Math.hypot(ld[0], ld[1]));
      const shade = 0.62 + 0.34 * (lit * 0.5 + 0.5);      // 0.62(그늘) ~ 0.96(빛)
      // ⚠️ 띠 두께는 **옆면의 실제 폭**과 같아야 한다. 예전엔 판의 5% 고정이라 두께보다
      //   훨씬 넓은 띠를 뽑아 늘렸고, 그래서 작품 안쪽 그림이 옆면에 번져 보였다.
      const stripPx = Math.max(2, Math.round(Math.min(iw, ih) * Math.max(0.006, depth)));
      const strip = edgeStrip(ins.canvas, s.name, stripPx);
      const w2 = warp(strip, s.quad, W, H, Object.assign({}, lightOpts, { exposure: baseExp * shade }));
      if (w2) ctx.drawImage(w2, 0, 0);
    }

    // ── 앞면 ────────────────────────────────────────────────────────────────
    const warped = warp(ins.canvas, box.front, W, H, Object.assign({}, lightOpts, { exposure: baseExp }));
    if (!warped) return null;
    ctx.drawImage(warped, 0, 0);
    // 디버그 마스크 — **본 판과 똑같은 quad** 로 워프한다(조명·톤·벽명암은 끄고).
    // 다시 계산하지 않으므로 마스크가 화면과 어긋날 수 없다.
    if (dbg && u.maskPlate) {
      const mw = warp(u.maskPlate, box.front, W, H, { exposure: 1 });
      if (mw) dbg.masks = mw;
    }

    // 앞면과 옆면이 만나는 모서리에 아주 얇은 선. 실제 캔버스·액자는 그 모서리가
    // 칼같이 꺾여 가는 그늘 선이 생긴다. 없으면 앞면과 옆면이 뭉개져 두께가 안 읽힌다.
    if (box.sides.length) {
      const lw = Math.max(1, Math.min(size.w, size.h) * 0.0035);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,.30)';
      ctx.lineWidth = lw;
      for (const s of box.sides) {
        ctx.beginPath();
        ctx.moveTo(s.quad[0][0], s.quad[0][1]);
        ctx.lineTo(s.quad[1][0], s.quad[1][1]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 구운 오버레이 — 액자가 작품 위로 드리우는 그림자(multiply) / 유리 반사(screen).
    // Flux 장면을 만들 때 함께 뽑아 두면 절차적 근사보다 훨씬 정확하다.
    if (scene.occImg && scene.occLoaded) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = scene.occAlpha == null ? 1 : scene.occAlpha;
      ctx.drawImage(scene.occImg, fit.dx, fit.dy, fit.sw, fit.sh);
      ctx.restore();
    }
    if (scene.refImg && scene.refLoaded) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = scene.refAlpha == null ? 1 : scene.refAlpha;
      ctx.drawImage(scene.refImg, fit.dx, fit.dy, fit.sw, fit.sh);
      ctx.restore();
    }

    // ── 전경(foreground) — 화분·소파·기둥이 작품 **앞을** 가린다 ──────────────
    // 경쟁사(Frameit)의 간판 기능. 작품이 장면의 뒤쪽 평면에 있다는 걸 한눈에
    // 알려줘서 깊이감이 즉시 생긴다. 알파 PNG 한 장이면 되므로 비용 대비 효과가 가장 크다.
    // ⚠️ 반드시 워프·오버레이 **다음**에 그려야 한다 — 순서가 바뀌면 가리는 게 아니라 가려진다.
    // ── 코너 폐색 — 조각 네 모서리 주변이 살짝 어둡다 ─────────────────────────
    // ⚠️ **판(plate)이 아니라 화면 좌표에 걸 것.** 판에만 걸면 판 경계에서 벽과 어긋나
    //    **검은 테**가 생긴다(실측: 흰 매트 액자 아래·오른변에서 벽 228 / 판 147).
    //    화면에 걸면 액자와 그 옆 벽이 **함께** 어두워져 단차가 없다 — 실제 사진도 그렇다
    //    (마이터 이음새의 상호 폐색 + 모서리로 갈수록 줄어드는 반사광).
    // 근거: 골든의 윗살 밝기가 160·183·178·178·166·172·169·176·**155** 로 **양 끝이 어둡다**.
    //    단조 기울기가 아니므로 광원 램프로는 재현되지 않는다(실제로 시도했다가 되돌렸다).
    const cornerAO = u.cornerAO == null ? 0.18 : u.cornerAO;
    if (cornerAO > 0) {
      // ⚠️ 반경·감쇠 모양을 함께 봐야 한다. 넓고 완만하면 **둥근 얼룩**으로 보이고,
      //    좁으면 살 끝(모서리에서 살 폭의 1.4배 지점)에 닿지 않아 아무 효과가 없다.
      //    가까이는 급히 떨어지고 멀리는 아주 옅게 끄는 모양이라야 '폐색'으로 읽힌다.
      const rr = Math.max(8, Math.min(size.w, size.h) * 0.13);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      for (const [px, py] of box.front) {
        const rg = ctx.createRadialGradient(px, py, 0, px, py, rr);
        rg.addColorStop(0, `rgba(0,0,0,${cornerAO})`);
        rg.addColorStop(0.30, `rgba(0,0,0,${(cornerAO * 0.50).toFixed(3)})`);
        rg.addColorStop(0.65, `rgba(0,0,0,${(cornerAO * 0.18).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
      }
      ctx.restore();
    }

    if (scene.fgImg && scene.fgLoaded) {
      ctx.drawImage(scene.fgImg, fit.dx, fit.dy, fit.sw, fit.sh);
    }
    // quad 는 **벽에 닿은 뒷면**(크기 계산의 진실), hitQuad 는 눈에 보이는 앞면(드래그 판정용)
    return {
      quad, hitQuad: box.front, fit, fitNote, zoom, depth,
      artRect: ins.artRect, regionPx: place ? place.regionPx : null,
      debug: dbg,
    };
  }

  // ==========================================================================
  //  장면 레지스트리 — scenes/scenes.json (없으면 장면 모드를 감춘다)
  // ==========================================================================
  function loadScenes(url, onReady) {
    fetch(url, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const list = (j && Array.isArray(j.scenes)) ? j.scenes : [];
        list.forEach((s) => {
          s.loaded = false;
          s.img = new Image();
          s.img.onload = () => { s.loaded = true; if (onReady) onReady(s); };
          s.img.src = s.src;
          if (s.occlusion) {
            s.occImg = new Image();
            s.occImg.onload = () => { s.occLoaded = true; if (onReady) onReady(s); };
            s.occImg.src = s.occlusion;
          }
          if (s.reflection) {
            s.refImg = new Image();
            s.refImg.onload = () => { s.refLoaded = true; if (onReady) onReady(s); };
            s.refImg.src = s.reflection;
          }
          if (s.foreground) {
            s.fgImg = new Image();
            s.fgImg.onload = () => { s.fgLoaded = true; if (onReady) onReady(s); };
            s.fgImg.src = s.foreground;
          }
        });
        if (onReady) onReady(null, list);
      })
      .catch(() => { if (onReady) onReady(null, []); });
  }

  // ==========================================================================
  //  작품 크기 문자열 → [가로cm, 세로cm]
  // ==========================================================================
  // 포트폴리오의 sizeText 는 작가가 자유롭게 적는다 — '116.8 × 91.0 cm' · '80x60' ·
  // '30호 (90.9×72.7cm)' 처럼 제각각이라 **숫자 두 개만** 뽑는다.
  // 읽지 못하면 null 을 돌려 장면의 기본 채움 비율로 앉게 한다(추측해서 틀리게 거는 것보다 낫다).
  function parseSizeCm(text) {
    const t = String(text == null ? '' : text);
    const m = t.match(/(\d+(?:\.\d+)?)\s*[x×X*╳]\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    let a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (!(a > 0 && b > 0)) return null;
    if (/\bmm\b/i.test(t) || a > 400 || b > 400) { a /= 10; b /= 10; }  // mm 로 적은 경우
    return [a, b];
  }

  global.ArtLookScene = {
    parseSizeCm,
    supported, warp, buildInsert, composeScene, loadScenes, sceneLightModel,
    homographyUnitToQuad, inv3, quadSize, fitScene, mapQuad, placeInRegion,
  };
})(window);
