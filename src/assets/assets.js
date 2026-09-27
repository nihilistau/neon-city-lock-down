// @ts-check
// The asset facade: the ONE door every binary asset (HDRI, PBR set, glTF prop,
// colour LUT) comes through.
//
// HYBRID BY CONTRACT. Every loader resolves to `null` on any failure — an id
// the manifest does not list, a file missing from disk, a decoder that throws,
// or `?noassets=1` — logs ONE warning per asset, and never rejects. Callers
// branch on null and build the procedural version the game shipped with, so a
// broken asset can cost looks but never the boot.
//
// Nothing is requested unless assets/manifest.json lists it: the browser logs
// every 404 as a console error, and the e2e suite treats a console error as a
// failure.
//
// Node-safe: imports three core only. The real loaders (GLTFLoader, HDRLoader,
// LUTCubeLoader, PMREM) are injected — src/assets/loaders.js builds them in the
// browser — so unit tests drive this with fakes.
import * as THREE from 'three';

/** @typedef {{path:string, role:string, name?:string, bytes?:number, sha256?:string}} ManifestFile */
/** @typedef {{id:string, kind:string, hasMetal?:boolean, files:ManifestFile[]}} ManifestEntry */
/**
 * @typedef {{map:THREE.Texture, normalMap:THREE.Texture, roughnessMap:THREE.Texture,
 *            aoMap:THREE.Texture, metalnessMap:THREE.Texture|null}} PbrSet
 */
/**
 * @typedef {object} AssetLoaders
 * @property {(url:string) => Promise<THREE.Texture>} texture 8-bit image (JPEG/PNG)
 * @property {(url:string) => Promise<THREE.DataTexture>} hdr float equirect (.hdr)
 * @property {(url:string) => Promise<{scene: THREE.Object3D}>} gltf
 * @property {(url:string) => Promise<{texture3D: THREE.Data3DTexture}>} lut .cube
 * @property {(equirect: THREE.Texture) => THREE.Texture} [pmrem] equirect → PMREM
 * @property {(scene: THREE.Object3D) => THREE.Object3D} [clone] deep clone (skeleton-aware in the browser)
 */
/** @typedef {'pbr'|'equirect'|'hdri'|'gltf'|'lut'} AssetKind */

/**
 * @param {{
 *   loaders?: AssetLoaders | Promise<AssetLoaders|null> | null,
 *   enabled?: boolean,
 *   base?: string,
 *   fetchJson?: (url:string) => Promise<any>,
 *   log?: (msg:string) => void,
 * }} [opts]
 */
export function createAssets(opts = {}) {
  const enabled = opts.enabled !== false;
  const base = opts.base ?? '/';
  const log = opts.log ?? ((m) => console.warn(m));
  const fetchJson = opts.fetchJson ?? (async (url) => {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

  /** @type {Map<string, ManifestEntry>} */
  const entries = new Map();
  /** @type {Map<string, Promise<any>>} */
  const pending = new Map();
  /** @type {Map<string, any>} */
  const done = new Map();
  const warned = new Set();
  /** @type {Set<THREE.Texture>} */
  const textures = new Set();
  let anisotropy = 1;
  /** @type {AssetLoaders|null} */
  let resolved = null;

  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    log(`[assets] ${msg}`);
  };
  const loaders = async () => {
    resolved ??= (await opts.loaders) ?? null;
    if (!resolved) throw new Error('no asset loaders');
    return resolved;
  };
  const url = (/** @type {ManifestFile} */ f) => `${base}${f.path}`;
  const cloneScene = (/** @type {THREE.Object3D} */ s) => (resolved?.clone ?? ((x) => x.clone(true)))(s);

  /** @param {string} id @param {string} kind */
  function entry(id, kind) {
    const e = entries.get(id);
    if (!e) throw new Error(`"${id}" is not in assets/manifest.json`);
    if (e.kind !== kind) throw new Error(`"${id}" is a ${e.kind}, not a ${kind}`);
    return e;
  }
  /** @param {ManifestEntry} e @param {string} role @param {string} [name] */
  function file(e, role, name) {
    const f = e.files.find((x) => x.role === role && (name === undefined || x.name === name));
    if (!f) throw new Error(`"${e.id}" has no ${name ? `${role} "${name}"` : role} file`);
    return f;
  }
  /** Resolve once per key; the promise never rejects. */
  function once(key, make) {
    let p = pending.get(key);
    if (p) return p;
    p = (async () => {
      if (!enabled) return null;
      try {
        const v = (await make()) ?? null;
        done.set(key, v);
        return v;
      } catch (err) {
        done.set(key, null);
        warnOnce(key, `${key} unavailable (${err instanceof Error ? err.message : err}) — using the procedural fallback`);
        return null;
      }
    })();
    pending.set(key, p);
    return p;
  }
  /** @param {THREE.Texture} t @param {boolean} srgb */
  const prep = (t, srgb) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    textures.add(t);
    return t;
  };
  /** 'pack/model' → ['pack', 'model'] @param {string} ref */
  const splitRef = (ref) => {
    const i = ref.indexOf('/');
    if (i <= 0) throw new Error(`"${ref}" is not a <pack>/<model> reference`);
    return [ref.slice(0, i), ref.slice(i + 1)];
  };

  const api = {
    get enabled() { return enabled; },

    /** Read the manifest. Nothing loads before this settles. */
    async init(manifestUrl = `${base}assets/manifest.json`) {
      if (!enabled) {
        log('[assets] disabled (?noassets=1) — every surface uses its procedural fallback');
        return;
      }
      try {
        const m = await fetchJson(manifestUrl);
        for (const e of m?.entries ?? []) entries.set(e.id, e);
      } catch (err) {
        warnOnce('manifest', `manifest unavailable (${err instanceof Error ? err.message : err}) — every asset falls back to procedural`);
      }
    },

    /** @param {string} id @param {string} role e.g. 'diff' */
    loadTexture(id, role) {
      return once(`texture:${id}:${role}`, async () => {
        const e = entries.get(id);
        if (!e) throw new Error(`"${id}" is not in assets/manifest.json`);
        const t = await (await loaders()).texture(url(file(e, role)));
        return prep(t, role === 'diff');
      });
    },

    /** @param {string} id @returns {Promise<PbrSet|null>} */
    loadPBR(id) {
      return once(`pbr:${id}`, async () => {
        const e = entry(id, 'pbr');
        const L = await loaders();
        const [map, normalMap, orm] = await Promise.all(['diff', 'nor', 'orm'].map((r) => L.texture(url(file(e, r)))));
        prep(map, true);
        prep(normalMap, false);
        prep(orm, false);
        return { map, normalMap, roughnessMap: orm, aoMap: orm, metalnessMap: e.hasMetal ? orm : null };
      });
    },
    /** @param {string} id @returns {PbrSet|null} */
    peekPBR: (id) => done.get(`pbr:${id}`) ?? null,

    /** @param {string} id @returns {Promise<THREE.DataTexture|null>} */
    loadEquirect(id) {
      return once(`equirect:${id}`, async () => {
        const e = entry(id, 'hdri');
        const t = await (await loaders()).hdr(url(file(e, 'hdr')));
        t.mapping = THREE.EquirectangularReflectionMapping;
        textures.add(t);
        return t;
      });
    },
    /** @param {string} id */
    peekEquirect: (id) => done.get(`equirect:${id}`) ?? null,

    /** The prefiltered (PMREM) environment for an HDRI. @param {string} id */
    loadHDRI(id) {
      return once(`hdri:${id}`, async () => {
        const eq = await api.loadEquirect(id);
        if (!eq) throw new Error('its equirect did not load');
        const L = await loaders();
        if (!L.pmrem) throw new Error('no PMREM generator');
        return L.pmrem(eq);
      });
    },

    /** @param {string} ref 'pack/model' @returns {Promise<THREE.Object3D|null>} a fresh clone */
    loadGLTF(ref) {
      return once(`gltf:${ref}`, async () => {
        const [pack, name] = splitRef(ref);
        const g = await (await loaders()).gltf(url(file(entry(pack, 'gltf'), 'model', name)));
        return g.scene;
      }).then((scene) => (scene ? cloneScene(scene) : null));
    },
    /** @param {string} ref @returns {THREE.Object3D|null} a fresh clone */
    peekGLTF(ref) {
      const s = done.get(`gltf:${ref}`);
      return s ? cloneScene(s) : null;
    },

    /** @param {string} id */
    loadLUT(id) {
      return once(`lut:${id}`, async () => (await loaders()).lut(url(file(entry(id, 'lut'), 'cube'))));
    },
    /** @param {string} id */
    peekLUT: (id) => done.get(`lut:${id}`) ?? null,

    /** @param {{kind: AssetKind, id: string}[]} list */
    async preload(list) {
      const by = { pbr: api.loadPBR, equirect: api.loadEquirect, hdri: api.loadHDRI, gltf: api.loadGLTF, lut: api.loadLUT };
      await Promise.all(list.map(({ kind, id }) => {
        const fn = by[kind];
        if (!fn) { warnOnce(`kind:${kind}`, `preload: unknown asset kind "${kind}"`); return null; }
        return fn(id);
      }));
    },

    /** @param {number} n */
    setAnisotropy(n) {
      anisotropy = n;
      for (const t of textures) {
        if (t.isDataTexture) continue;   // float equirects are sampled by PMREM, not at grazing angles
        t.anisotropy = n;
        t.needsUpdate = true;
      }
    },

    /** Every texture the facade has created (for the texture-memory log). */
    textures: () => [...textures],
  };
  return api;
}
