---
description: Set up recurring Nexus audits and scans via mcp__scheduled-tasks__*
disable-model-invocation: true
---

Nexus's dashboard mode runs an in-process 5-minute Overseer risk poller, but **MCPB-standalone users get no scheduled scans by default**. This skill teaches you to close that gap using CC's native `mcp__scheduled-tasks__*` tools.

## Recommended schedule

| Task | Cron | Interval | What it does |
|---|---|---|---|
| **Risk scan** | `7 */6 * * *` | Every 6h (minute 7 to avoid top-of-hour load) | Call `nexus_predict_gaps` + `nexus_get_critique` to surface stale tasks, stuck work, uncommitted drift, cold projects |
| **Digest** | `23 9 * * *` | Daily at 9:23 AM local | Call `nexus_brief` + generate a one-paragraph summary of the previous day's activity |
| **Code audit** | `17 3 * * 1` | Weekly Mondays at 3:17 AM | Run `/nexus-audit` against the current project |

All times are **local timezone**, per the `mcp__scheduled-tasks__create_scheduled_task` contract.

## Set up the risk scan (example)

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "nexus-risk-scan",
  cronExpression: "7 */6 * * *",
  description: "Nexus 6h risk scan — stale tasks, stuck work, uncommitted drift",
  prompt: "Run nexus_predict_gaps and nexus_get_critique. If any critical risks are returned, create a task for the highest-impact one and log an activity entry. Otherwise log 'All instruments nominal' to the activity stream."
})
```

## Set up the daily digest

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "nexus-daily-digest",
  cronExpression: "23 9 * * *",
  description: "Nexus daily digest — yesterday's activity recap",
  prompt: "Call nexus_brief for the primary project. Summarize what happened yesterday in 3-5 bullets. Log the summary as an activity entry with type='digest'."
})
```

## Why not just use the in-process poller?

- It only fires when the dashboard server is running
- MCPB-only users (Claude Desktop without dashboard) get nothing
- CC scheduled-tasks fire whenever CC is idle, regardless of Nexus mode

Both can coexist — the in-process poller handles real-time UI notifications; CC scheduled-tasks handle the ambient background cadence.

## Pick minutes that AREN'T :00 or :30

Every user who schedules "every 6 hours" gets `0 */6` — which means a lot of fleet instances hit Anthropic at exactly the same moment. Offset by a few minutes (7, 13, 23, 37…) to spread load. The `mcp__scheduled-tasks__*` tool enforces this convention for recurring schedules.

## Cleaning up

Review your Nexus-related schedules with `mcp__scheduled-tasks__list_scheduled_tasks`. Remove obsolete ones with `mcp__scheduled-tasks__update_scheduled_task({taskId: "...", enabled: false})` or delete the `~/.claude/scheduled-tasks/<taskId>/` directory directly.
