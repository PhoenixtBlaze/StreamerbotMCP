# Streamerbot MCP Server

An **agent-native** [MCP](https://modelcontextprotocol.io/) server for [Streamer.bot](https://streamer.bot/). Built for streamers who describe goals in plain language and let an AI agent configure, test, and run automations — without learning Streamer.bot internals.

**v2 highlights:** compact action discovery, automation planning, live testing without restarts, C# script generation, scene/event helpers, bridge actions for globals, WebSocket auth, HTTP triggers.

---

## For streamers (one minute)

1. Install **Streamer.bot**, enable **WebSocket Server** (Servers/Clients, note port e.g. `8081`).
2. Add this MCP server to Cursor / Claude (see below).
3. Tell your AI: *“Set up my stream so the StreamElements overlay only shows in my ingame scene.”*
4. The agent runs `validate_setup`, plans with `describe_automation`, guides you through a few UI clicks if needed, and tests with `do_action` — **no bot restart**.

Read [docs/live-dev-workflow.md](docs/live-dev-workflow.md) and [docs/automation-patterns.md](docs/automation-patterns.md).

---

## Prerequisites

- **Node.js 18+**
- **Streamer.bot** with **WebSocket Server** started (and optional **HTTP Server** on port `7474`)
- If WebSocket password is enabled (v0.2.5+), set `STREAMERBOT_PASSWORD`

---

## Installation

```bash
git clone <this-repo>
cd StreamerbotMCP
npm install
npm run build
```

### Cursor `mcp.json` example

```json
{
  "mcpServers": {
    "streamerbot": {
      "command": "node",
      "args": ["G:/StreamerbotMCP/dist/index.js"],
      "env": {
        "STREAMERBOT_HOST": "127.0.0.1",
        "STREAMERBOT_PORT": "8081",
        "STREAMERBOT_HTTP_PORT": "7474",
        "STREAMERBOT_PASSWORD": "",
        "STREAMERBOT_DATA_PATH": "E:/path/to/Streamer.bot/data",
        "STREAMERBOT_PRIMITIVES": "{\"overlay_show\":\"SE Overlay Show\",\"overlay_hide\":\"SE Overlay Hide\"}"
      }
    }
  }
}
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STREAMERBOT_HOST` | `127.0.0.1` | Streamer.bot host |
| `STREAMERBOT_PORT` | `8080` | WebSocket port |
| `STREAMERBOT_HTTP_PORT` | `7474` | HTTP server port |
| `STREAMERBOT_ENDPOINT` | `/` | WebSocket path |
| `STREAMERBOT_PASSWORD` | *(empty)* | WebSocket auth password |
| `STREAMERBOT_EVENT_BUFFER` | `200` | Max buffered events |
| `STREAMERBOT_DATA_PATH` | *(empty)* | Optional `data` folder for read-only `actions.json` index |
| `STREAMERBOT_PRIMITIVES` | overlay show/hide names | JSON map of primitive keys → action names |
| `STREAMERBOT_BRIDGE_SET_GLOBAL` | `MCP Set Global` | Bridge action for setting globals |

---

## Agent workflow (start here)

| Step | Tool |
|------|------|
| 1 | `get_agent_guide` |
| 2 | `validate_setup` |
| 3 | `describe_automation` with the user’s goal |
| 4 | `get_ui_walkthrough` for any UI steps |
| 5 | `test_action` / `trigger_primitive` to verify |
| 6 | `generate_csharp_script` if custom logic is needed |

**Agents should prefer** `list_action_groups` / `find_actions` over full `get_actions`.

---

## Tools (summary)

### Setup & guidance

`get_agent_guide`, `validate_setup`, `get_ui_walkthrough`, `get_bridge_setup_guide`, `get_import_checklist`, `describe_automation`

### Connection

`connect`, `disconnect`, `get_connection_status`, `get_info`, `get_broadcaster`, `get_active_viewers`

### Actions (compact + run)

`list_action_groups`, `list_actions_in_group`, `find_actions`, `get_action_detail`, `get_actions`, `do_action`, `do_action_http`, `test_action`, `trigger_primitive`

### Events & OBS

`subscribe_preset`, `subscribe_to_events`, `subscribe_to_all_events`, `get_recent_events`, `summarize_recent_events`, `wait_for_event`, `get_current_scene`, …

### State & chat

`set_global_via_action`, `get_globals`, `get_global`, `send_message` (requires `confirm=true`), `get_commands`, credits tools

### C# & disk

`list_csharp_templates`, `generate_csharp_script`, `inspect_actions_from_disk`

### Advanced

`raw_request`, `execute_code_trigger`, Twitch/YouTube utilities

Full list: build and inspect `src/index.ts` or ask the agent to call `get_agent_guide`.

---

## Resources

| URI | Description |
|-----|-------------|
| `streamerbot://agent-guide` | Agent operating guide (markdown) |
| `streamerbot://actions-summary` | Compact group summary |
| `streamerbot://connection` | Connection + last scene |
| `streamerbot://event-buffer` | Summarized recent events |

---

## Development

```bash
npm run build
npm start
```

---

## Docs

- [Live dev workflow (no restart)](docs/live-dev-workflow.md)
- [Automation patterns](docs/automation-patterns.md)
- [Scene overlay template](templates/scene-overlay-router.md)
- [Roadmap / implemented features](docs/ROADMAP.md)

---

## Official Streamer.bot references

- [WebSocket requests](https://docs.streamer.bot/api/websocket/requests)
- [HTTP DoAction](https://docs.streamer.bot/api/http/requests/do-action)
- [Actions guide](https://docs.streamer.bot/guide/actions)
- [Import & export](https://docs.streamer.bot/guide/import-export)
