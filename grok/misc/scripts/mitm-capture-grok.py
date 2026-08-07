"""
mitmproxy addon that captures the grok CLI's real model-facing HTTP requests
(cli-chat-proxy.grok.com, grok.com, and api.x.ai) to a redacted JSONL file, one line per
HTTP request/response pair.

grok (~/.grok/bin/grok) is a native Rust binary, not a Bun/Node process,
so the claude-code-style `BUN_OPTIONS=--preload` fetch-patching trick does not
apply. Instead this captures at the network layer: grok's HTTP client respects
the standard HTTPS_PROXY/https_proxy env vars and (when SSL_CERT_FILE points at
mitmproxy's CA) accepts mitmproxy's TLS interception, so a local mitmdump
instance can see the exact JSON body sent to the OAuth proxy or public xAI
`/v1/responses` endpoint, including the full `tools[]` array of JSON
schemas and the `input[]` array containing the system/user messages.

Usage:
    mitmdump --listen-port 8899 -s misc/scripts/mitm-capture-grok.py \
        --set grok_capture_out=/path/to/capture.jsonl

Then, in another terminal, with the proxy pointed at the same port:
    HTTPS_PROXY=http://127.0.0.1:8899 https_proxy=http://127.0.0.1:8899 \
    SSL_CERT_FILE="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
    grok -p "Reply exactly: GROK_TRACE_OK" --output-format json

Secrets handling:
    The Authorization header carries a live xAI OAuth bearer token (the same
    credential material as ~/.grok/auth.json). This addon omits it and every
    other auth-shaped header before anything is written to disk. Never retain
    those headers in capture evidence.
"""

import hashlib
import json
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from mitmproxy import ctx, http

CAPTURE_HOSTS = ("cli-chat-proxy.grok.com", "grok.com", "api.x.ai")
AUTH_HEADER_MARKERS = (
    "authorization",
    "api-key",
    "apikey",
    "cookie",
    "credential",
    "secret",
    "token",
)
CAPTURE_MARKERS = ("GROK_TRACE_OK", "GROK_INTERACTIVE_TRACE_OK")
COMPLETION_SIGNALS = (
    "response.completed",
    '"status":"completed"',
    '"status": "completed"',
    "data: [DONE]",
)


def safe_url(url):
    """Retain endpoint identity without persisting signed/auth query values."""
    parsed = urlsplit(url)
    safe_query = urlencode(
        [(key, value) for key, value in parse_qsl(parsed.query) if key == "alt"]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, safe_query, ""))


def redact_headers(headers):
    """Return non-authentication headers only.

    Omitting auth-shaped headers entirely keeps even their names out of retained
    evidence and avoids relying on a placeholder remaining intact downstream.
    """
    out = {}
    for k, v in headers.items():
        normalized_name = k.lower().replace("_", "-")
        if not any(marker in normalized_name for marker in AUTH_HEADER_MARKERS):
            out[k] = v
    return out


def request_marker(body):
    return next((marker for marker in CAPTURE_MARKERS if marker in body), None)


def response_text(body):
    """Flatten text-like SSE/JSON values so split deltas can prove a marker."""
    strings = []
    text_fragments = []
    text_keys = {"content", "delta", "output_text", "text"}

    def collect(value, key=None):
        if isinstance(value, str):
            strings.append(value)
            if key in text_keys:
                text_fragments.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for child_key, item in value.items():
                collect(item, child_key)

    for line in body.splitlines():
        payload = line.strip()
        if payload.startswith("data:"):
            payload = payload[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            collect(json.loads(payload))
        except json.JSONDecodeError:
            continue

    # Joining text fragments without a separator detects markers split across
    # deltas while the all-string fallback handles provider-specific fields.
    return body + "\n" + "".join(text_fragments) + "\n" + "".join(strings)


def response_evidence(response):
    if response is None:
        return {
            "response_status": None,
            "response_bytes": 0,
            "response_body_sha256": None,
            "response_complete": False,
            "response_markers": [],
        }

    body = response.get_text(strict=False) if response.raw_content else ""
    flattened = response_text(body)
    markers = [marker for marker in CAPTURE_MARKERS if marker in flattened]
    status = response.status_code
    status_ok = 200 <= status < 300
    complete = status_ok and (
        bool(markers) or any(signal in body for signal in COMPLETION_SIGNALS)
    )
    raw = response.raw_content or b""
    return {
        "response_status": status,
        "response_bytes": len(raw),
        "response_body_sha256": hashlib.sha256(raw).hexdigest() if raw else None,
        "response_complete": complete,
        "response_markers": markers,
    }


class GrokCapture:
    def load(self, loader):
        loader.add_option(
            name="grok_capture_out",
            typespec=str,
            default=os.path.join(
                os.environ.get("CAPTURE_SCRATCH_DIR", "."),
                "grok",
                "raw",
                "capture.jsonl",
            ),
            help="Path to append redacted request/response JSON lines to.",
        )

    def response(self, flow: http.HTTPFlow) -> None:
        host = flow.request.pretty_host
        if host not in CAPTURE_HOSTS or not flow.request.path.startswith("/v1/responses"):
            return

        request_body = (
            flow.request.get_text(strict=False) if flow.request.raw_content else None
        )
        record = {
            "method": flow.request.method,
            "url": safe_url(flow.request.pretty_url),
            "request_headers": redact_headers(flow.request.headers),
            "request_body": request_body,
            "capture_marker": request_marker(request_body or ""),
            "response_headers": redact_headers(flow.response.headers) if flow.response else None,
            **response_evidence(flow.response),
        }

        out_path = ctx.options.grok_capture_out
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        ctx.log.info(
            f"grok-capture: wrote {flow.request.method} "
            f"{safe_url(flow.request.pretty_url)} -> {out_path}"
        )

    def error(self, flow: http.HTTPFlow) -> None:
        host = flow.request.pretty_host
        if host not in CAPTURE_HOSTS or not flow.request.path.startswith("/v1/responses"):
            return

        request_body = (
            flow.request.get_text(strict=False) if flow.request.raw_content else None
        )
        record = {
            "method": flow.request.method,
            "url": safe_url(flow.request.pretty_url),
            "request_headers": redact_headers(flow.request.headers),
            "request_body": request_body,
            "capture_marker": request_marker(request_body or ""),
            "response_headers": None,
            **response_evidence(None),
            "response_error": str(flow.error) if flow.error else "unknown transport error",
        }
        out_path = ctx.options.grok_capture_out
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as capture:
            capture.write(json.dumps(record) + "\n")
        ctx.log.warning(
            f"grok-capture: recorded failed {flow.request.method} "
            f"{safe_url(flow.request.pretty_url)} -> {out_path}"
        )


addons = [GrokCapture()]
