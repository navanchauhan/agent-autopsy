"""
Capture Antigravity model request bodies without writing authentication headers.

Usage:
    mitmdump --listen-port 8898 -s antigravity/misc/scripts/mitm-capture-antigravity.py \
        --set antigravity_capture_out=/path/to/capture.jsonl
"""

import json
import os

from mitmproxy import ctx, http


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

    def request(self, flow: http.HTTPFlow) -> None:
        if (
            flow.request.pretty_host != "daily-cloudcode-pa.googleapis.com"
            or "streamGenerateContent" not in flow.request.path
        ):
            return

        record = {
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "request_body": flow.request.get_text(strict=False)
            if flow.request.raw_content
            else None,
        }
        out_path = ctx.options.antigravity_capture_out
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as capture:
            capture.write(json.dumps(record) + "\n")


addons = [AntigravityCapture()]
