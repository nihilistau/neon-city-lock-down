// @ts-check
// Shared HTTP hardening for the localhost creation-kit servers. These servers can
// write files, so a malicious web page the user visits (while a server runs) could
// otherwise drive them via CSRF. We (1) allow only same-machine Origins (or none,
// for native tools like curl) on state-changing requests, and (2) cap body size.

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** True if the request's Origin is same-machine or absent (native tools). */
export function originAllowed(req) {
  const o = req.headers?.origin;
  return !o || LOCAL_ORIGIN.test(o);
}

/** Read a request body with a hard size cap (default 8 MB). Rejects if exceeded. */
export function readBodyCapped(req, maxBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    req.on('data', (c) => {
      len += c.length;
      if (len > maxBytes) { req.destroy(); reject(new Error(`body exceeds ${maxBytes} bytes`)); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
