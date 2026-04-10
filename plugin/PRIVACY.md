# Privacy Policy

## Data Collection

Nexus stores all data locally on your machine at `~/.nexus/nexus.json`. This includes:
- Task titles and descriptions
- Session summaries and decisions
- Activity log entries
- Fuel usage readings
- Knowledge Graph (decisions + relationships)
- Thought Stack entries
- Bookmarks

## No External Transmission

Nexus does not send data to any external server or cloud service. All MCP tool calls are processed in-process by the local NexusStore.

## Optional Local AI

If you choose to use the Overseer features (AI analysis, code audit, session planning), Nexus sends data to a local AI model running on your machine (LM Studio at localhost:1234 or Ollama at localhost:11434). This communication stays on localhost and never leaves your network.

## Data Deletion

Delete `~/.nexus/` to remove all Nexus data. Uninstalling the plugin does not delete your data — you must remove the directory manually.

## Third-Party Services

None. Nexus has zero external dependencies at runtime.
