// @ts-check
// Outfit recipes per character. The full 10-state matrix lands in Phase 4;
// the slice ships enough to prove wardrobe changes end-to-end.

/** @type {Record<string, Record<string, {pieces:any[], warmth?:number}>>} */
export const OUTFITS = {
  lola: {
    evening_wear: {
      pieces: [
        { piece: 'dress', color: '#3d1028', roughness: 0.4, metalness: 0.15, opts: { hem: 0.38 } },
        { piece: 'leggings', color: '#141018', roughness: 0.6 },
      ],
      warmth: 0.5,
    },
    casual_lounge: {
      pieces: [
        { piece: 'top', color: '#1c1424', roughness: 0.8 },
        { piece: 'shorts', color: '#241a20', roughness: 0.8 },
      ],
      warmth: 0.35,
    },
  },
  aria: {
    casual_lounge: {
      pieces: [
        { piece: 'top', color: '#c9a6e8', roughness: 0.85 },
        { piece: 'shorts', color: '#4a3a5c', roughness: 0.8 },
      ],
      warmth: 0.35,
    },
    evening_wear: {
      pieces: [
        { piece: 'dress', color: '#5c3a7a', roughness: 0.45, metalness: 0.1, opts: { hem: 0.40 } },
      ],
      warmth: 0.45,
    },
  },
};
