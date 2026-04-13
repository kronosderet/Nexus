---
description: Verify Nexus installation health — store, AI, hooks, tools
disable-model-invocation: true
---

Run a comprehensive health check of the Nexus installation. Test each subsystem and report status:

1. **Store**: Call `mcp__nexus__nexus_brief` — if it returns data, the store is readable. Report task count, session count, decision count.

2. **MCP Tools**: Call `mcp__nexus__nexus_search` with query "test" — if it returns (even empty), the search/embedding pipeline works.

3. **Thought Stack**: Call `mcp__nexus__nexus_push_thought` with text "health-check probe" and then immediately `mcp__nexus__nexus_pop_thought` — if both succeed, the stack is operational. This is a non-destructive round-trip test.

4. **Fuel Tracking**: Check if the brief response includes fuel data. If session_percent and weekly_percent are present, fuel tracking is active.

5. **Knowledge Graph**: Check if the brief mentions decisions/edges. Report count.

Format the output as a health report:

```
◈ NEXUS HEALTH CHECK
  Store:       OK (X tasks, Y sessions, Z decisions)
  MCP Tools:   OK (search operational)
  Thoughts:    OK (push/pop round-trip clean)
  Fuel:        OK (session X% | weekly Y%)
  Graph:       OK (Z decisions, N edges)
  ─────────────
  Status:      All systems nominal
```

If any check fails, report it as FAIL with the error. Suggest fixes for common issues (e.g., "Store: FAIL — run `claude plugin add kronosderet/Nexus` to install").
