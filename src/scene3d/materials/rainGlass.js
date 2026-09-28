// @ts-check
// Rain on the curtain wall. An onBeforeCompile patch for the glass panes'
// MeshStandardMaterial: a procedural droplet sheet (two layers, some drops
// hanging, some sliding) in the pane's own plane, which
//   - bends the normal the reflections are looked up with — each droplet is a
//     little lens throwing the HDRI city and the room's neon back at a different
//     angle (the "refraction offset": a forward renderer has no screen texture to
//     refract without a transmission pass, and this reads the same at glass scale)
//   - raises the pane's opacity under each drop, so droplets catch light
//     instead of vanishing into the 18% glass.
// All panes share ONE pair of uniforms, so the world updates rain with two writes.
//
// The glass is already reflect-boosted (reflectBoost.js), so this patch runs
// AFTER whatever onBeforeCompile the material carries instead of replacing it,
// and its cache key extends the existing one — replacing either would drop the
// boost silently.
import * as THREE from 'three';
import { keepPatchOnClone } from './patchClone.js';

export const RAIN_GLASS_UNIFORMS = {
  uRainTime: { value: 0 },
  /** 0 = dry glass, 1 = raining (World3D.setRainDensity) */
  uRain: { value: 1 },
};

const KEY = 'rain-on-glass';

const VERT_PARS = /* glsl */ 'varying vec3 vRainP;';
const VERT_MAIN = /* glsl */ 'vRainP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';

const FRAG_PARS = /* glsl */ `
uniform float uRainTime;
uniform float uRain;
varying vec3 vRainP;
float rainHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
// One droplet layer on a CELL-metre grid. xy = the drop's slope (its lens
// normal), z = coverage 0..1. Only some cells hold a drop — a drop in every
// cell read as an even lattice of glowing dots, not rain — and each cell picks
// its own speed, so the sheet never slides as one block.
vec3 rainDrops( vec2 p, float cell, float t ) {
  vec2 g = p / cell;
  vec2 id = floor( g );
  float h = rainHash( id );
  if ( rainHash( id + 19.3 ) > 0.45 ) return vec3( 0.0 );
  float slide = step( 0.6, h ) * fract( t * ( 0.15 + h * 0.35 ) + h );
  vec2 c = vec2( 0.25 + 0.5 * rainHash( id + 7.1 ), 0.8 - slide * 0.6 );
  // a touch taller than wide: water sags under its own weight
  vec2 d = ( fract( g ) - c ) / ( ( 0.1 + 0.14 * rainHash( id + 3.7 ) ) * vec2( 1.0, 1.25 ) );
  float m = 1.0 - dot( d, d );
  return m > 0.0 ? vec3( d * m, m ) : vec3( 0.0 );
}`;

const FRAG_COLOR = /* glsl */ `
// the pane is vertical and runs along X or Z, so x+z is "along the pane"
vec2 rainPlane = vec2( vRainP.x + vRainP.z, vRainP.y );
vec3 rainD = rainDrops( rainPlane, 0.07, uRainTime ) + 0.6 * rainDrops( rainPlane + 13.0, 0.035, uRainTime * 1.3 );
float rainCover = clamp( rainD.z, 0.0, 1.0 ) * uRain;
diffuseColor.a = mix( diffuseColor.a, min( 1.0, diffuseColor.a + 0.2 ), rainCover );`;

const FRAG_NORMAL = /* glsl */ `
{
  vec3 rainWN = inverseTransformDirection( normal, viewMatrix );
  vec3 rainH = normalize( cross( vec3( 0.0, 1.0, 0.0 ), rainWN ) + vec3( 1e-5 ) );
  vec3 rainBend = rainH * rainD.x + vec3( 0.0, 1.0, 0.0 ) * rainD.y;
  normal = normalize( normal + ( viewMatrix * vec4( rainBend, 0.0 ) ).xyz * 0.45 * uRain );
}`;

/**
 * @template {THREE.MeshStandardMaterial} M
 * @param {M} material a fresh glass material (optionally already reflect-boosted) — never a shared library one
 * @returns {M}
 */
export function applyRainOnGlass(material) {
  const prev = material.onBeforeCompile;
  // an unpatched material keys on onBeforeCompile.toString(); only an earlier patch's own key composes
  const prevKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')
    ? material.customProgramCacheKey() : null;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uRainTime = RAIN_GLASS_UNIFORMS.uRainTime;
    shader.uniforms.uRain = RAIN_GLASS_UNIFORMS.uRain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  material.customProgramCacheKey = prevKey ? () => `${prevKey}|${KEY}` : () => KEY;
  // keepPatchOnClone stacks: a clone runs the earlier patch's clone first, then gets rain again
  return keepPatchOnClone(material, applyRainOnGlass);
}
