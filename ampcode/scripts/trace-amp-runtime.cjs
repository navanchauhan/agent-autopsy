const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");

const outDir =
  process.env.AMP_TRACE_DIR ||
  process.env.TRACE_DIR ||
  path.join(process.cwd(), "artifacts", "trace", "amp");
fs.mkdirSync(outDir, { recursive: true });

let sequence = 0;
const textDecoder = new TextDecoder();

function redactText(value) {
  return String(value)
    .replace(/sgamp_[A-Za-z0-9._-]+/g, "sgamp_***")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "eyJ***")
    .replace(
      /("(?:accessToken|refreshToken|idToken|apiKey|authorization|cookie|set-cookie)"\s*:\s*")[^"]+/gi,
      "$1***",
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 ***");
}

function writeRecord(kind, value) {
  const record = {
    id: randomUUID(),
    sequence: ++sequence,
    kind,
    ts: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    ...value,
  };
  const fileName = `${String(record.sequence).padStart(5, "0")}-${kind}-${record.id}.json`;
  fs.writeFileSync(path.join(outDir, fileName), `${JSON.stringify(record, null, 2)}\n`);
}

function headerObject(headers) {
  const out = {};
  const h = new Headers(headers || {});
  for (const [key, value] of h.entries()) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie" ||
      lower === "x-api-key" ||
      lower.endsWith("-token")
    ) {
      out[lower] = "***";
    } else {
      out[lower] = redactText(value);
    }
  }
  return out;
}

function bufferFromData(data) {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Buffer.isBuffer(data)) return data;
  return null;
}

function isMostlyText(text) {
  if (!text) return false;
  let printable = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      printable += 1;
    }
  }
  return printable / text.length > 0.85;
}

function serializeData(data) {
  if (data == null) return { type: "empty", byteLength: 0 };
  if (typeof data === "string") {
    return { type: "text", byteLength: Buffer.byteLength(data), text: redactText(data) };
  }
  if (typeof URLSearchParams !== "undefined" && data instanceof URLSearchParams) {
    const text = data.toString();
    return { type: "text", byteLength: Buffer.byteLength(text), text: redactText(text) };
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { type: "blob", byteLength: data.size, mimeType: data.type || null };
  }

  const buffer = bufferFromData(data);
  if (!buffer) {
    return { type: typeof data, summary: Object.prototype.toString.call(data) };
  }

  const text = textDecoder.decode(buffer);
  if (isMostlyText(text)) {
    return { type: "text", byteLength: buffer.byteLength, text: redactText(text) };
  }
  return {
    type: "binary",
    byteLength: buffer.byteLength,
    base64Prefix: buffer.subarray(0, 512).toString("base64"),
  };
}

function shouldCaptureUrl(url) {
  return /ampcode|amp\.code|anthropic|openai|googleapis|generativelanguage|api\.x\.ai/i.test(url);
}

function installFetchTrace() {
  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (!originalFetch) return;

  globalThis.fetch = async function tracedFetch(input, init = {}) {
    const request = new Request(input, init);
    const capture = shouldCaptureUrl(request.url);

    if (capture) {
      let body = { type: "unavailable" };
      try {
        body = serializeData(await request.clone().arrayBuffer());
      } catch (error) {
        body = { type: "error", message: String(error?.message || error) };
      }

      writeRecord("fetch-request", {
        request: {
          method: request.method,
          url: redactText(request.url),
          headers: headerObject(request.headers),
          body,
        },
      });
    }

    const response = await originalFetch(request);

    if (capture) {
      let body = { type: "unavailable" };
      const contentType = response.headers.get("content-type") || "";
      if (/json|text|event-stream|javascript/i.test(contentType)) {
        try {
          body = serializeData(await response.clone().arrayBuffer());
        } catch (error) {
          body = { type: "error", message: String(error?.message || error) };
        }
      }

      writeRecord("fetch-response", {
        response: {
          url: redactText(response.url),
          status: response.status,
          statusText: response.statusText,
          headers: headerObject(response.headers),
          body,
        },
      });
    }

    return response;
  };
}

function installWebSocketTrace() {
  const OriginalWebSocket = globalThis.WebSocket;
  if (!OriginalWebSocket) return;

  function TracedWebSocket(url, protocols) {
    const socket =
      protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
    const socketId = randomUUID();
    writeRecord("websocket-open", {
      websocket: {
        id: socketId,
        url: redactText(String(url)),
        protocols: protocols || null,
      },
    });

    const originalSend = socket.send.bind(socket);
    socket.send = function tracedSend(data) {
      writeRecord("websocket-message", {
        websocket: {
          id: socketId,
          direction: "send",
          data: serializeData(data),
        },
      });
      return originalSend(data);
    };

    socket.addEventListener("message", (event) => {
      writeRecord("websocket-message", {
        websocket: {
          id: socketId,
          direction: "receive",
          data: serializeData(event.data),
        },
      });
    });
    socket.addEventListener("close", (event) => {
      writeRecord("websocket-close", {
        websocket: {
          id: socketId,
          code: event.code,
          reason: redactText(event.reason || ""),
          wasClean: event.wasClean,
        },
      });
    });
    socket.addEventListener("error", () => {
      writeRecord("websocket-error", { websocket: { id: socketId } });
    });

    return socket;
  }

  TracedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(TracedWebSocket, OriginalWebSocket);
  globalThis.WebSocket = TracedWebSocket;
}

function installDigestTrace() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle?.digest) return;

  const originalDigest = subtle.digest.bind(subtle);
  const tracedDigest = function tracedDigest(algorithm, data) {
    writeRecord("digest-input", {
      digest: {
        algorithm: typeof algorithm === "string" ? algorithm : algorithm?.name || String(algorithm),
        data: serializeData(data),
      },
    });
    return originalDigest(algorithm, data);
  };

  try {
    subtle.digest = tracedDigest;
  } catch {
    Object.defineProperty(subtle, "digest", {
      configurable: true,
      writable: true,
      value: tracedDigest,
    });
  }
}

installFetchTrace();
installWebSocketTrace();
installDigestTrace();
