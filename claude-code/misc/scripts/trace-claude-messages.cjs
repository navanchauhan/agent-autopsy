const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const outDir =
  process.env.CLAUDE_TRACE_DIR ||
  (process.env.CAPTURE_SCRATCH_DIR
    ? path.join(process.env.CAPTURE_SCRATCH_DIR, "claude-code", "raw", "messages")
    : path.join(process.cwd(), "artifacts", "trace", "messages"));
fs.mkdirSync(outDir, { recursive: true });

const originalFetch = globalThis.fetch?.bind(globalThis);
if (!originalFetch) {
  throw new Error("globalThis.fetch is not available");
}

const pendingResponseObservers = new Set();

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
      lower === "proxy-authorization" ||
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

function writeRecord(filePath, record) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(record, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function observeResponse(response, record, filePath) {
  let observer;
  try {
    const clone = response.clone();
    observer = (async () => {
      try {
        const body = await clone.text();
        record.response.completed = true;
        record.response.body_bytes = Buffer.byteLength(body);
        record.response.terminal_event =
          /^event:\s*message_stop\s*$/m.test(body) ||
          /"type"\s*:\s*"message_stop"/.test(body);
        record.response.error_event =
          /^event:\s*error\s*$/m.test(body) || /"type"\s*:\s*"error"/.test(body);
      } catch (error) {
        record.response.completed = false;
        record.response.observe_error_name = error?.name || "Error";
      } finally {
        writeRecord(filePath, record);
      }
    })();
  } catch (error) {
    record.response.completed = false;
    record.response.observe_error_name = error?.name || "Error";
    writeRecord(filePath, record);
    return;
  }

  pendingResponseObservers.add(observer);
  observer.finally(() => pendingResponseObservers.delete(observer));
}

process.on("beforeExit", async () => {
  if (pendingResponseObservers.size > 0) {
    await Promise.allSettled([...pendingResponseObservers]);
  }
});

globalThis.fetch = async function tracedFetch(input, init = {}) {
  // IMPORTANT: do not rebuild the request via `new Request(input, init)` and forward
  // that to the real fetch. The WHATWG Request constructor only keeps standard
  // RequestInit fields and silently drops non-standard ones (e.g. the `tls: { ca }`
  // custom CA bundle the Claude Code binary attaches to its own fetch calls), which
  // breaks SSL verification. Instead, capture logging info from `input`/`init`
  // directly and forward the original `input`/`init` untouched.
  const url =
    typeof input === "string" || input instanceof URL ? String(input) : input?.url;

  let record = null;
  let filePath = null;
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

    record = {
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
    filePath = path.join(outDir, `${record.ts.replace(/[:.]/g, "-")}-${record.id}.json`);
    writeRecord(filePath, record);
  }

  try {
    const response = await originalFetch(input, init);
    if (record && filePath) {
      record.response = {
        status: response.status,
        status_text: response.statusText,
        ok: response.ok,
        headers: redactHeaders(response.headers),
        completed: false,
        terminal_event: false,
        error_event: false,
      };
      writeRecord(filePath, record);
      observeResponse(response, record, filePath);
    }
    return response;
  } catch (error) {
    if (record && filePath) {
      record.response = {
        network_error: true,
        error_name: error?.name || "Error",
        completed: false,
      };
      writeRecord(filePath, record);
    }
    throw error;
  }
};
