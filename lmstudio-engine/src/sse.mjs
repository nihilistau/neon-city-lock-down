// @ts-check
// Server-Sent Events helpers. `openSSE(res)` writes the SSE headers and returns
// a small sender: `.send(event, data)`, `.comment()`, `.end()`. Each event is a
// named SSE frame (`event: <name>\n data: <json>\n\n`).

/** @param {import('node:http').ServerResponse} res */
export function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // initial comment flushes headers on some proxies
  res.write(': open\n\n');
  let open = true;
  res.on('close', () => { open = false; });
  return {
    get open() { return open; },
    /** @param {string} event @param {any} data */
    send(event, data) {
      if (!open) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
    },
    comment(text = '') { if (open) res.write(`: ${text}\n\n`); },
    end() { if (open) { open = false; res.end(); } },
  };
}
