"""mitmproxy addon: write each HTTP flow to $EVIDENCE_DIR/http/<time>-<id>.json.

Credential-bearing headers are replaced before anything touches disk. Bodies are
kept verbatim because they are the evidence; the directory never leaves the run.
"""

import json
import os
import time
import uuid

OUT = os.path.join(os.environ.get("EVIDENCE_DIR", "/scratch/evidence"), "http")
SECRET_HEADERS = {
    "authorization", "proxy-authorization", "x-api-key", "cookie", "set-cookie",
    "x-goog-api-key", "x-goog-user-project",
}
MAX_BODY = 32 * 1024 * 1024


def _headers(headers):
    return {k.lower(): ("***" if k.lower() in SECRET_HEADERS else v) for k, v in headers.items()}


def _body(message):
    if message is None or message.raw_content is None:
        return None
    text = message.get_text(strict=False)
    return text if text is None or len(text) <= MAX_BODY else text[:MAX_BODY]


def response(flow):
    os.makedirs(OUT, exist_ok=True)
    record = {
        "time": flow.request.timestamp_start,
        "request": {
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "headers": _headers(flow.request.headers),
            "body": _body(flow.request),
        },
        "response": {
            "status": flow.response.status_code,
            "headers": _headers(flow.response.headers),
            "body": _body(flow.response),
        },
    }
    name = f"{time.time():.6f}-{uuid.uuid4().hex[:8]}.json"
    tmp = os.path.join(OUT, f".{name}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(record, handle)
    os.replace(tmp, os.path.join(OUT, name))
