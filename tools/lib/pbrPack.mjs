// @ts-check
/**
 * Pack single-channel AO / roughness / metalness rasters into ONE RGB raster in
 * the glTF "ORM" layout, which is exactly what three reads: aoMap samples R,
 * roughnessMap samples G, metalnessMap samples B. Three maps in one texture is
 * two fewer downloads, decodes and texture units per material.
 * @param {{size:number, ao:Buffer|null, rough:Buffer, metal:Buffer|null}} o
 *   each a size×size single-channel raster
 * @returns {Buffer} size×size×3
 */
export function packOrm({ size, ao, rough, metal }) {
  const n = size * size;
  for (const [k, b] of /** @type {[string, Buffer|null][]} */ ([['ao', ao], ['rough', rough], ['metal', metal]])) {
    if (b && b.length !== n) throw new Error(`${k}: ${b.length} bytes, expected ${n} (one channel at ${size}x${size})`);
  }
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = ao ? ao[i] : 255;          // no AO map = unoccluded
    out[i * 3 + 1] = rough[i];
    out[i * 3 + 2] = metal ? metal[i] : 0;  // no metal map = dielectric (the facade then omits metalnessMap)
  }
  return out;
}
