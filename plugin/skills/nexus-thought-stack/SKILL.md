---
description: Use the Nexus Thought Stack + CC spawn_task together for bidirectional interrupt recovery
disable-model-invocation: true
---

The Thought Stack is Nexus's LIFO interrupt-recovery memory. Push before context switches, pop when you return. The Nexus SessionStart hook auto-pops the top thought and shows it as `◈ RESUME: ...` — so cross-session continuity happens for free.

## The bridge to CC side-tasks (v4.3+)

When a thought relates to discrete sub-work, you can surface it in CC's native side-task chip UI via `mcp__ccd_session__spawn_task`. The pattern:

```
1. nexus_push_thought(text: "...", related_task_id: N)
2. mcp__ccd_session__spawn_task(reason: "...", prompt: "Resolve task #N by ... When done, call nexus_complete_task(N).")
3. (later) spawned session completes and calls nexus_complete_task(N)
4. Nexus auto-pops the linked thought because related_task_id matches
```

The thought is now visible in TWO surfaces at once:
- **Nexus Thought Stack** — persistent across all Claude instances, appears in `◈ RESUME` at next SessionStart
- **CC side-task chip** — ambient UI, one-click to resume or dismiss

Completion in either surface propagates: finishing the spawned task auto-pops the thought; manually popping with `nexus_pop_thought` doesn't close the CC side-task (CC controls that UI).

## When to use the bridge

Use both surfaces when:
- The work is discrete enough to run in its own session/worktree
- You want it visible in the UI (CC chip) AND in cross-instance memory (Nexus stack)
- There's a clear task ID it resolves

Use Nexus Thought Stack alone when:
- It's a note-to-self, not a work item
- The thought is about *where you were*, not *what's next*
- No sub-task exists (the "nexus_push_thought text only" case)

Use CC `spawn_task` alone when:
- The side work is truly out-of-scope for any Nexus task (e.g. spotted a typo in README)
- It's transient — complete-or-dismiss, no need to survive across instances

## Auto-resume pattern (SessionStart)

The SessionStart hook auto-pops the top thought and injects it as `◈ RESUME: <text>`. When you see this, you have two options:

1. **Resume the work directly** — the context snippet tells you where to pick up
2. **Mark a chapter** — per the `/nexus-brief` skill, call `mcp__ccd_session__mark_chapter("Resume: <excerpt>")` to anchor the transcript TOC

The hook has already marked the thought as resolved (popped), so you don't need to call `nexus_pop_thought` again.
