// 이미지에서 dominant color 추출 (canvas 샘플링)
export function extractColor(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 10;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve('#1a1a2e'); return; }
      let data: Uint8ClampedArray;
      try {
        ctx.drawImage(img, 0, 0, size, size);
        data = ctx.getImageData(0, 0, size, size).data;
      } catch {
        // CORS 가 한 번 어긋나 canvas 가 오염되면 getImageData 가 던진다 — 예전엔 promise 가 영원히 안 끝나 전 슬라이드 색이 죽었다(2026-09-19)
        resolve('#1a1a2e'); return;
      }
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      r = Math.round(r * 0.6);
      g = Math.round(g * 0.6);
      b = Math.round(b * 0.6);
      resolve(`rgb(${r},${g},${b})`);
    };
    img.onerror = () => resolve('#1a1a2e');
    img.src = src;
  });
}
