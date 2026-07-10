"""
mitmproxy addon that captures the grok CLI's real model-facing HTTP requests
(cli-chat-proxy.grok.com and grok.com) to a redacted JSONL file, one line per
HTTP request/response pair.

grok (~/.grok/bin/grok) is a native Mach-O Rust binary, not a Bun/Node process,
so the claude-code-style `BUN_OPTIONS=--preload` fetch-patching trick does not
apply. Instead this captures at the network layer: grok's HTTP client respects
the standard HTTPS_PROXY/https_proxy env vars and (when SSL_CERT_FILE points at
mitmproxy's CA) accepts mitmproxy's TLS interception, so a local mitmdump
instance can see the exact JSON body sent to https://cli-chat-proxy.grok.com/v1/responses
(xAI's "Responses"-style API), including the full `tools[]` array of JSON
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
    credential material as ~/.grok/auth.json). This addon redacts it (and any
    other auth-shaped header) to "***" before anything is written to disk,
    mirroring claude-code/misc/scripts/trace-claude-messages.cjs's header
    redaction. Never remove this redaction.
"""

import json

from mitmproxy import ctx, http

CAPTURE_HOSTS = ("cli-chat-proxy.grok.com", "grok.com")
REDACT_HEADERS = {"authorization", "x-api-key", "cookie", "set-cookie", "x-xai-token-auth"}


def redact_headers(headers):
    out = {}
    for k, v in headers.items():
        out[k] = "***" if k.lower() in REDACT_HEADERS else v
    return out


class GrokCapture:
    def load(self, loader):
        loader.add_option(
            name="grok_capture_out",
            typespec=str,
            default="grok-capture.jsonl",
            help="Path to append redacted request/response JSON lines to.",
        )

    def response(self, flow: http.HTTPFlow) -> None:
        host = flow.request.pretty_host
        if host not in CAPTURE_HOSTS:
            return

        record = {
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "request_headers": redact_headers(flow.request.headers),
            "request_body": flow.request.get_text(strict=False) if flow.request.raw_content else None,
            "response_status": flow.response.status_code if flow.response else None,
            "response_headers": dict(flow.response.headers) if flow.response else None,
            "response_body": flow.response.get_text(strict=False) if flow.response and flow.response.raw_content else None,
        }

        out_path = ctx.options.grok_capture_out
        with open(out_path, "a") as f:
            f.write(json.dumps(record) + "\n")
        ctx.log.info(f"grok-capture: wrote {flow.request.method} {flow.request.pretty_url} -> {out_path}")


addons = [GrokCapture()]
