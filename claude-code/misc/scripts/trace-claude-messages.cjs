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
  // IMPORTANT: do not rebuild the request via `new Request(input, init)` and forward
  // that to the real fetch. The WHATWG Request constructor only keeps standard
  // RequestInit fields and silently drops non-standard ones (e.g. the `tls: { ca }`
  // custom CA bundle the Claude Code binary attaches to its own fetch calls), which
  // breaks SSL verification. Instead, capture logging info from `input`/`init`
  // directly and forward the original `input`/`init` untouched.
  const url =
    typeof input === "string" || input instanceof URL ? String(input) : input?.url;

  if (url && shouldCapture(url)) {
    const method = init.method || (typeof input === "object" && input?.method) || "GET";
    const headersSource = init.headers || (typeof input === "object" && input?.headers) || {};
    let body = "";
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body && typeof init.body.text === "function") {
      body = await readBody(init.body);
    } else if (typeof input === "object" && input?.body) {
      try {
        body = await readBody(input.clone());
      } catch {
        body = "";
      }
    }

    const record = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      pid: process.pid,
      hostname: os.hostname(),
      request: {
        method,
        url,
        headers: redactHeaders(headersSource),
        body,
      },
    };
    fs.writeFileSync(
      path.join(outDir, `${record.ts.replace(/[:.]/g, "-")}-${record.id}.json`),
      JSON.stringify(record, null, 2),
    );
  }

  return originalFetch(input, init);
};
