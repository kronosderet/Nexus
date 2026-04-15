---
description: Run a code audit using the local AI Overseer to analyze the codebase
disable-model-invocation: true
---

Start an async code audit using `mcp__nexus__nexus_ask_overseer_start`.

Compose a question that includes the key source files from the current project (read them with the Read tool first, then pass their contents as the question text).

Set `skip_context: true` and provide a `system_prompt` focused on code review:
"You are a senior code auditor. Find REAL bugs, security issues, dead code, and inconsistencies. For each: file, severity, one-line description."

After starting, inform the user to check back with `mcp__nexus__nexus_get_overseer_result` — the local AI may take several minutes depending on context size.

## Running on a schedule (v4.3+)

To have this audit run automatically (e.g. weekly), use CC's native scheduled-tasks:

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "nexus-weekly-audit",
  cronExpression: "17 3 * * 1",
  description: "Weekly Nexus code audit via Overseer",
  prompt: "Invoke the /nexus-audit skill against the current project. When done, log a session summary via nexus_log_session with tag='audit'."
})
```

See the `/nexus-schedule` skill for more scheduling patterns (6h risk scans, daily digests, etc.).

Why this matters: the dashboard-mode Overseer poller only runs when `npm run dashboard` is up. CC scheduled-tasks fire whenever CC is idle, so MCPB-standalone users get audit coverage too.
