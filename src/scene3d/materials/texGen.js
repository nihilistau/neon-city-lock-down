// @ts-check
// Canvas2D procedural texture factory. All textures are generated, cached by
// recipe key, and cheap (small canvases, tiling).
import * as THREE from 'three';

/** @type {Map<string, THREE.CanvasTexture>} */
const cache = new Map();

function make(key, size, drawFn, { repeat = 1 } = {}) {
  let tex = cache.get(key);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawFn(c.getContext('2d'), size);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  cache.set(key, tex);
  return tex;
}

function noise(ctx, size, alpha, mono = true) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 255 * alpha;
    img.data[i] += n;
    img.data[i + 1] += mono ? n : (Math.random() - 0.5) * 255 * alpha;
    img.data[i + 2] += mono ? n : (Math.random() - 0.5) * 255 * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

/** Dark concrete/plaster with subtle grime. */
export function concreteTex(tint = '#181c2a', repeat = 2) {
  return make(`concrete:${tint}:${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.06);
    // grime streaks
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#456';
      const x = Math.random() * s;
      ctx.fillRect(x, 0, 2 + Math.random() * 12, s);
    }
    ctx.globalAlpha = 1;
  }, { repeat });
}

/** Large dark floor tiles with grout lines and sheen variation. */
export function tileTex(tint = '#11141f', grout = '#05060a', tiles = 4, repeat = 3) {
  return make(`tile:${tint}:${tiles}:${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.045);
    ctx.strokeStyle = grout;
    ctx.lineWidth = 3;
    const step = s / tiles;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(s, i * step); ctx.stroke();
    }
    // per-tile sheen variance
    for (let x = 0; x < tiles; x++) for (let y = 0; y < tiles; y++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
      ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
    }
  }, { repeat });
}

/** Brushed metal panels with seams. */
export function metalTex(tint = '#2a3040', repeat = 2) {
  return make(`metal:${tint}:${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    // brush lines
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
      ctx.fillRect(0, y, s, 1);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s / 2);
    ctx.strokeRect(0, s / 2, s, s / 2);
  }, { repeat });
}

/** Fabric weave for upholstery. */
export function fabricTex(tint = '#2c2434', repeat = 4) {
  return make(`fabric:${tint}:${repeat}`, 128, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < s; y += 3) {
      ctx.fillStyle = (y / 3) % 2 ? '#000' : '#fff';
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = (x / 3) % 2 ? '#000' : '#fff';
      ctx.fillRect(x, 0, 1, s);
    }
    ctx.globalAlpha = 1;
    noise(ctx, s, 0.05);
  }, { repeat });
}

/** Dark wood planks. */
export function woodTex(tint = '#2b1e18', repeat = 2) {
  return make(`wood:${tint}:${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? '10,5,3' : '90,60,40'},${0.1 + Math.random() * 0.15})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      const y = Math.random() * s;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (Math.random() - 0.5) * 14, s * 0.7, y + (Math.random() - 0.5) * 14, s, y);
      ctx.stroke();
    }
    // plank seams
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * s / 4); ctx.lineTo(s, i * s / 4); ctx.stroke();
    }
  }, { repeat });
}

/** Veined marble for bar tops / vanity. */
export function marbleTex(tint = '#353b4a', repeat = 1) {
  return make(`marble:${tint}:${repeat}`, 256, (ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05);
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(220,225,235,${0.06 + Math.random() * 0.10})`;
      ctx.lineWidth = 1 + Math.random() * 1.5;
      ctx.beginPath();
      let x = Math.random() * s, y = 0;
      ctx.moveTo(x, y);
      while (y < s) {
        x += (Math.random() - 0.5) * 40;
        y += 10 + Math.random() * 25;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, { repeat });
}
