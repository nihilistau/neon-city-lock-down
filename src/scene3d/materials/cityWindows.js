// @ts-check
// The exterior towers' lit-window texture. The canvas version is the fallback
// for assets/city/windows.jpg and the first frame before that image decodes.
// Seeded, so every run and every screenshot shows the same skyline windows.
import * as THREE from 'three';
import { hashStr, mulberry32 } from '../../core/rng.js';

export function cityWindowsTexture() {
  const rand = mulberry32(hashStr('city-windows'));
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (rand() < 0.42) {
        ctx.fillStyle = rand() < 0.16 ? '#ff6fc0' : (rand() < 0.5 ? '#6eefff' : '#ffd9a0');
        ctx.globalAlpha = 0.35 + rand() * 0.65;
        ctx.fillRect(x, y, 4, 3);
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
