const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const outDir =
  process.env.CLAUDE_TRACE_DIR ||
  path.join(process.cwd(), "artifacts", "trace", "messages");
fs.mkdirSync(outDir, { recursive: true });

const originalFetch = globalThis.fetch?.bind(globalThis);
if (!originalFetch) {
  throw new Error("globalThis.fetch is not available");
}

function shouldCapture(url) {
  return /\/v1\/messages(\?|$)/.test(url);
}

async function readBody(body) {
  if (!body) return "";
  return await body.text();
}

function redactHeaders(headers) {
  const out = {};
  const h = new Headers(headers || {});
  for (const [key, value] of h.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "cookie" ||
      lower === "set-cookie"
    ) {
      out[lower] = "***";
    } else {
      out[lower] = value;
    }
  }
  return out;
}

globalThis.fetch = async function tracedFetch(input, init = {}) {
  const request = new Request(input, init);
  if (shouldCapture(request.url)) {
    const requestClone = request.clone();
    const body = await readBody(requestClone);
    const record = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
      request: {
        method: request.method,
        url: request.url,
        headers: redactHeaders(request.headers),
        body,
      },
    };
    fs.writeFileSync(
      path.join(outDir, `${record.ts.replace(/[:.]/g, "-")}-${record.id}.json`),
      JSON.stringify(record, null, 2),
    );
  }

  return originalFetch(request);
};
