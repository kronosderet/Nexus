---
description: Get the current Nexus metabrain state — fuel, tasks, sessions, decisions, risks
disable-model-invocation: true
---

Call the `mcp__nexus__nexus_brief` tool with the current project name to get a full metabrain briefing.

If the user specifies a project name, use that. Otherwise detect the project from the current working directory.

Show the result directly to the user — it contains fuel state, active tasks, recent sessions, key decisions, and risks.

## Chapter marking convention (v4.3+)

The SessionStart hook ends its metabrain context with a line like:

```
◈ Chapter: mark_chapter("Setting course on Nexus")
```

When you see that suggestion, call `mcp__ccd_session__mark_chapter` with the quoted title. This anchors the CC transcript TOC at the right spot and makes the session navigable. The Cartographer provides the title; you provide the mark.

Honor the suggestion unless:
- The user's first turn makes the suggestion obviously wrong (e.g. they pivoted to an unrelated task)
- You're already mid-chapter and it would fragment the transcript

Also consider calling `mark_chapter` at other natural transitions during the session:
- After a meaningful landmark (task completed, feature shipped, decision recorded) — title like "Landmark reached: X"
- When the user pivots to a new area of work — title like "Pivoting to Y"
- Before a long verification phase — title like "Verifying Z"

Keep titles short (under 40 chars, noun-phrase form). Don't mark a chapter at the very first message of a session — that's implicit.
