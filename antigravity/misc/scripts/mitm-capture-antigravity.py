"""
Capture Antigravity model request bodies without writing authentication headers.

Usage:
    mitmdump --listen-port 8898 -s antigravity/misc/scripts/mitm-capture-antigravity.py \
        --set antigravity_capture_out=/path/to/capture.jsonl
"""

import hashlib
import json
import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from mitmproxy import ctx, http


CAPTURE_HOST = "daily-cloudcode-pa.googleapis.com"
CAPTURE_MARKERS = (
    "ANTIGRAVITY_TRACE_OK",
    "ANTIGRAVITY_INTERACTIVE_TRACE_OK",
)
COMPLETION_SIGNALS = (
    '"finishReason":"STOP"',
    '"finishReason": "STOP"',
    '"finish_reason":"STOP"',
    '"finish_reason": "STOP"',
    "data: [DONE]",
)


def safe_url(url):
    """Retain `alt=sse` while dropping signed/auth query values."""
    parsed = urlsplit(url)
    safe_query = urlencode(
        [(key, value) for key, value in parse_qsl(parsed.query) if key == "alt"]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, safe_query, ""))


def should_capture(flow):
    return (
        flow.request.pretty_host == CAPTURE_HOST
        and "streamGenerateContent" in flow.request.path
    )


def request_marker(body):
    return next((marker for marker in CAPTURE_MARKERS if marker in body), None)


def response_text(body):
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


class AntigravityCapture:
    def load(self, loader):
        loader.add_option(
            name="antigravity_capture_out",
            typespec=str,
            default=os.path.join(
                os.environ.get("CAPTURE_SCRATCH_DIR", "."),
                "antigravity",
                "raw",
                "capture.jsonl",
            ),
            help="Path to append model request bodies to.",
        )

    def response(self, flow: http.HTTPFlow) -> None:
        if not should_capture(flow):
            return

        request_body = (
            flow.request.get_text(strict=False)
            if flow.request.raw_content
            else None
        )
        record = {
            "method": flow.request.method,
            "url": safe_url(flow.request.pretty_url),
            "request_body": request_body,
            "capture_marker": request_marker(request_body or ""),
            **response_evidence(flow.response),
        }
        out_path = ctx.options.antigravity_capture_out
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as capture:
            capture.write(json.dumps(record) + "\n")

    def error(self, flow: http.HTTPFlow) -> None:
        if not should_capture(flow):
            return

        request_body = (
            flow.request.get_text(strict=False)
            if flow.request.raw_content
            else None
        )
        record = {
            "method": flow.request.method,
            "url": safe_url(flow.request.pretty_url),
            "request_body": request_body,
            "capture_marker": request_marker(request_body or ""),
            **response_evidence(None),
            "response_error": str(flow.error) if flow.error else "unknown transport error",
        }
        out_path = ctx.options.antigravity_capture_out
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as capture:
            capture.write(json.dumps(record) + "\n")


addons = [AntigravityCapture()]
