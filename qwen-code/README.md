# Qwen Code

This directory stores normalized model-facing prompts, tool schemas, and runtime
messages extracted from exact tagged revisions of
[`QwenLM/qwen-code`](https://github.com/QwenLM/qwen-code).

`VERSION` records the source revision and release. `SURFACES.json` records
coverage and provenance. The daily refresh reads the public source directly;
it does not send a model request or intercept network traffic.
