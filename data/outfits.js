// @ts-check
// Outfit recipes per character — the 10-state matrix. The `none` state renders
// as a towel or robe unless the explicitness cap is 'full' (wardrobe.js handles
// the substitution). Pieces are procedural primitives skinned to the body.

/** shared piece builders keyed by intent */
const dress = (color, hem, metal = 0.1) => ({ piece: 'dress', color, roughness: 0.45, metalness: metal, opts: { hem } });
const top = (color, r = 0.85) => ({ piece: 'top', color, roughness: r });
const shorts = (color) => ({ piece: 'shorts', color, roughness: 0.8 });
const leggings = (color) => ({ piece: 'leggings', color, roughness: 0.6 });
const robeP = (color) => ({ piece: 'robe', color, roughness: 0.9 });
const towelP = (color) => ({ piece: 'towel', color, roughness: 1 });

/** @type {Record<string, Record<string, {pieces:any[], warmth?:number}>>} */
export const OUTFITS = {
  lola: {
    street_armor: { pieces: [top('#241a20', 0.5), leggings('#141018'), { piece: 'jacket', color: '#2a1420', roughness: 0.5, metalness: 0.3 }], warmth: 0.8 },
    evening_wear: { pieces: [dress('#3d1028', 0.38, 0.15), leggings('#141018')], warmth: 0.5 },
    casual_lounge: { pieces: [top('#1c1424'), shorts('#241a20')], warmth: 0.35 },
    workout: { pieces: [top('#2a1a24', 0.9), shorts('#1a1420')], warmth: 0.3 },
    swim: { pieces: [top('#3d1028', 0.95), shorts('#3d1028')], warmth: 0.15 },
    sleepwear: { pieces: [top('#2c2434', 0.95), shorts('#2c2434')], warmth: 0.35 },
    robe: { pieces: [robeP('#3a1420')], warmth: 0.4 },
    towel: { pieces: [towelP('#8a7a6a')], warmth: 0.2 },
    underwear: { pieces: [top('#241820', 0.95), shorts('#241820')], warmth: 0.1 },
    none: { pieces: [], warmth: 0.05 },
  },
  aria: {
    street_armor: { pieces: [top('#4a3a5c', 0.7), leggings('#2e2438'), { piece: 'jacket', color: '#3a2c4a', roughness: 0.6 }], warmth: 0.75 },
    evening_wear: { pieces: [dress('#5c3a7a', 0.40)], warmth: 0.45 },
    casual_lounge: { pieces: [top('#c9a6e8'), shorts('#4a3a5c')], warmth: 0.35 },
    workout: { pieces: [top('#9d6bff', 0.9), shorts('#2e2438')], warmth: 0.3 },
    swim: { pieces: [top('#9d6bff', 0.95), shorts('#9d6bff')], warmth: 0.15 },
    sleepwear: { pieces: [top('#d4c2e8', 0.95), shorts('#c9a6e8')], warmth: 0.35 },
    robe: { pieces: [robeP('#b89ad0')], warmth: 0.4 },
    towel: { pieces: [towelP('#e0d4c4')], warmth: 0.2 },
    underwear: { pieces: [top('#c9a6e8', 0.95), shorts('#c9a6e8')], warmth: 0.1 },
    none: { pieces: [], warmth: 0.05 },
  },
  kai: {
    street_armor: { pieces: [top('#2a2418', 0.6), leggings('#1a160e'), { piece: 'jacket', color: '#2c2416', roughness: 0.5 }], warmth: 0.8 },
    evening_wear: { pieces: [top('#1a1810', 0.5), leggings('#14110a')], warmth: 0.55 },
    casual_lounge: { pieces: [top('#2c2820'), leggings('#1a160e')], warmth: 0.4 },
    workout: { pieces: [top('#2a2418', 0.9), shorts('#1a160e')], warmth: 0.3 },
    swim: { pieces: [shorts('#2a2418')], warmth: 0.15 },
    sleepwear: { pieces: [shorts('#2c2820')], warmth: 0.3 },
    robe: { pieces: [robeP('#2c2416')], warmth: 0.4 },
    towel: { pieces: [towelP('#8a7a6a')], warmth: 0.2 },
    underwear: { pieces: [shorts('#1a160e')], warmth: 0.1 },
    none: { pieces: [], warmth: 0.05 },
  },
};

/** default per-character starting outfit */
export const DEFAULT_OUTFIT = { lola: 'evening_wear', aria: 'casual_lounge', kai: 'casual_lounge' };
