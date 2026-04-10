---
description: Run a code audit using the local AI Overseer to analyze the codebase
disable-model-invocation: true
---

Start an async code audit using `mcp__nexus__nexus_ask_overseer_start`.

Compose a question that includes the key source files from the current project (read them with the Read tool first, then pass their contents as the question text).

Set `skip_context: true` and provide a `system_prompt` focused on code review:
"You are a senior code auditor. Find REAL bugs, security issues, dead code, and inconsistencies. For each: file, severity, one-line description."

After starting, inform the user to check back with `mcp__nexus__nexus_get_overseer_result` — the local AI may take several minutes depending on context size.
