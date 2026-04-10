---
description: Generate an AI-powered session plan based on fuel, tasks, and knowledge graph
disable-model-invocation: true
---

Call the `mcp__nexus__nexus_get_plan` tool to generate a session plan.

If the user specifies a project, pass it. The plan considers current fuel state, active tasks, and the knowledge graph to recommend what to work on and what to avoid.

Note: This requires a local AI model (LM Studio) to be running. If unavailable, inform the user.
