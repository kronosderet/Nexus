---
description: Check current session fuel runway against upcoming calendar events and recommend wrap-up time
disable-model-invocation: true
---

Nexus's `nexus_calendar_runway` tool computes the overlap between your remaining session fuel and upcoming calendar events — but Nexus can't fetch your calendar itself. This skill wires the two sides together.

## The two-step dance

1. **Fetch upcoming events from the calendar MCP.**
   The Google Calendar MCP (and most alternatives) expose `list_events` — call it with a 5-hour window from now:

   ```
   mcp__<calendar-server>__list_events({
     startTime: "<ISO now>",
     endTime:   "<ISO now+5h>",
     pageSize:  20
   })
   ```

   The exact tool name varies by install. Look for one ending in `list_events`.

2. **Pass the events to Nexus.**
   Map the calendar response's items to a simple `{start, title}` shape and call:

   ```
   mcp__nexus__nexus_calendar_runway({
     events: [
       { start: "2026-04-15T14:30:00+02:00", title: "Sprint planning" },
       { start: "2026-04-15T16:00:00+02:00", title: "1:1 with Veronika" }
     ],
     buffer_minutes: 15   // optional, default 15
   })
   ```

3. **Relay the recommendation to the user.** Nexus returns a Cartographer-voiced summary with the next event, current fuel + runway, and a classification:

   - **comfortable** — plenty of room, wrap-by suggestion is just a heads-up
   - **tight** — wrap-by soon; plan your next action to fit
   - **wrap_now** — stop coding, commit, log a session summary
   - **unreachable** — fuel runs out before the meeting starts; conserve remaining fuel for emergencies

## Edge cases

- **No calendar MCP connected** — Nexus will happily accept an empty `events: []` and respond with "Runway clear". But the feature is most useful when you actually have a calendar. If nothing's installed, suggest `mcp__mcp-registry__search_mcp_registry` with `["calendar"]` to discover connectors.
- **Empty calendar window** — `events: []` → "Runway clear. Build freely."
- **Events beyond 2× runway** — filtered out server-side (not actionable from this session).
- **All-day events** — currently treated as regular events with `start` being midnight. This is noisy if you have all-day blocks marked. Future enhancement: filter by duration.
- **Fresh session (fuel > 80%)** — the brief's runway-tip appears only when fuel is 20–80% because early-session planning rarely matters. The skill itself always works regardless.

## When to invoke

- Starting a multi-task session — *"Is there time to refactor this module, or should I batch smaller fixes?"*
- Mid-session check after a long stretch — *"How much runway do I have left before the standup?"*
- Returning from a break — the SessionStart `◈ RESUME:` line is a natural cue to check your calendar before diving back in.

## The Cartographer voice

Responses use short, calm phrasing ("Runway clear", "Comfortable window", "Wrap up now — meeting in Xm"). Don't paraphrase into cheerier language; the user knows the tone.
