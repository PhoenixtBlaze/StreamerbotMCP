# Streamer.bot MCP Server

A Work in Progress but possibally a full-featured [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes **every capability of the [Streamer.bot](https://streamer.bot/) WebSocket API** as MCP tools and resources. Connect any MCP-compatible AI agent (GitHub Copilot, Claude Desktop, Cursor, etc.) and let it fully control your Streamer.bot instance.

---

## Features

- **23 MCP tools** covering every WebSocket API endpoint
- **12 live resources** for read access to all major data stores
- Persistent WebSocket connection with **automatic reconnection**
- In-memory **ring-buffer event capture** — subscribe to any/all events and query them
- Auto-subscribes to all 44+ event categories on startup
- Works with **Twitch, YouTube, and Kick** platforms
- Full support for **global variables, user variables, credits, commands, code triggers, chat**, and more

---

## Prerequisites

1. **Node.js 18+** installed
2. **Streamer.bot** running with the **WebSocket Server enabled**:
   - Open Streamer.bot → *Servers/Clients* → *WebSocket Server*
   - Set port (default: `8080`) and click **Start**
   - Optionally configure a password

---

## Installation

```bash
git clone <this-repo>
cd StreamerbotMCP
npm install
npm run build
```

---

## Configuration

All configuration is via environment variables:

| Variable                  | Default       | Description                                              |
|---------------------------|---------------|----------------------------------------------------------|
| `STREAMERBOT_HOST`        | `127.0.0.1`   | Host where Streamer.bot is running                       |
| `STREAMERBOT_PORT`        | `8080`        | Streamer.bot WebSocket server port                       |
| `STREAMERBOT_ENDPOINT`    | `/`           | WebSocket endpoint path                                  |
| `STREAMERBOT_PASSWORD`    | *(empty)*     | Password if WebSocket auth is enabled                    |
| `STREAMERBOT_EVENT_BUFFER`| `200`         | Max number of events to hold in the in-memory ring buffer|

---

## Adding to Your MCP Client

### VS Code (GitHub Copilot Agent)

Add to your VS Code `settings.json` or workspace `mcp.json`:

Ensure you change [Directory of repo clone] in the bellow given json's to actual directory

```json
{
  "mcpServers": {
    "streamerbot": {
      "command": "node",
      "args": ["[Directory of repo clone]/StreamerbotMCP/dist/index.js"],
      "env": {
        "STREAMERBOT_HOST": "127.0.0.1",
        "STREAMERBOT_PORT": "8080"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json` (usually `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "streamerbot": {
      "command": "node",
      "args": ["[Directory of repo clone]/StreamerbotMCP/dist/index.js"],
      "env": {
        "STREAMERBOT_HOST": "127.0.0.1",
        "STREAMERBOT_PORT": "8080",
        "STREAMERBOT_PASSWORD": "your-password-here"
      }
    }
  }
}
```

---

## Development

```bash
# Run without building (uses ts-node)
npm run dev

# Build and run
npm run build
npm start
```

---

## Tools Reference

### Connection & Instance

| Tool | Description |
|------|-------------|
| `get_connection_status` | Get current connection state and config |
| `connect` | Connect (or reconnect) with optional host/port/password override |
| `disconnect` | Disconnect from Streamer.bot |
| `get_info` | Instance version, OS, and uptime |
| `get_broadcaster` | Connected broadcaster accounts across all platforms |
| `get_active_viewers` | Live viewer list |

### Actions

| Tool | Description |
|------|-------------|
| `get_actions` | List all actions (IDs, names, groups, enabled state) |
| `do_action` | Execute any action by ID or name with optional arguments |

### Events & Subscriptions

| Tool | Description |
|------|-------------|
| `get_events` | All subscribable event categories and types |
| `subscribe_to_events` | Subscribe to specific categories/types |
| `subscribe_to_all_events` | Subscribe to every event at once |
| `unsubscribe_from_events` | Remove specific subscriptions |
| `get_recent_events` | Query the event buffer (with source/type filters) |
| `clear_event_buffer` | Wipe the event buffer |
| `get_subscribed_events` | List active subscriptions |

### Code Triggers

| Tool | Description |
|------|-------------|
| `get_code_triggers` | List all custom code triggers |
| `execute_code_trigger` | Fire a code trigger by name with optional args |

### Commands

| Tool | Description |
|------|-------------|
| `get_commands` | List all chat commands and their config |

### Credits

| Tool | Description |
|------|-------------|
| `get_credits` | Fetch current credits roll data |
| `test_credits` | Fill credits with test data |
| `clear_credits` | Reset all credits |

### Chat

| Tool | Description |
|------|-------------|
| `send_message` | Send a chat message on Twitch, Kick, or YouTube |

### Global Variables

| Tool | Description |
|------|-------------|
| `get_globals` | All global variables (persisted or temporary) |
| `get_global` | Single global variable by name |
| `twitch_get_user_globals` | A specific user variable across all Twitch users |
| `twitch_get_user_global` | All/specific variables for one Twitch user |

### Emotes

| Tool | Description |
|------|-------------|
| `twitch_get_emotes` | Available Twitch emotes |
| `youtube_get_emotes` | Available YouTube emotes |

### User Utilities

| Tool | Description |
|------|-------------|
| `get_user_pronouns` | Look up a user's pronouns |

### Advanced

| Tool | Description |
|------|-------------|
| `raw_request` | Send an arbitrary JSON request to the WebSocket API |

---

## Resources Reference

| Resource URI | Description |
|--------------|-------------|
| `streamerbot://info` | Instance info |
| `streamerbot://broadcaster` | Broadcaster account info |
| `streamerbot://actions` | All defined actions |
| `streamerbot://commands` | All defined commands |
| `streamerbot://active-viewers` | Current live viewers |
| `streamerbot://globals/persisted` | Persistent global variables |
| `streamerbot://globals/temporary` | Session global variables |
| `streamerbot://credits` | Credits roll data |
| `streamerbot://events` | All subscribable events |
| `streamerbot://event-buffer` | Last 200 received events |
| `streamerbot://code-triggers` | Custom code triggers |
| `streamerbot://connection` | Connection status and config |

---

## Event Categories

All 44+ Streamer.bot event categories are supported:

`Application`, `Command`, `CrowdControl`, `Custom`, `DonorDrive`, `Elgato`, `FileTail`, `FileWatcher`, `Fourthwall`, `General`, `Group`, `HypeRate`, `Inputs`, `Kick`, `KoFi`, `MeldStudio`, `MIDI`, `Misc`, `OBS`, `Pallygg`, `Patreon`, `Pulsoid`, `Quote`, `Raw`, `Shopify`, `SpeakerBot`, `SpeechToText`, `StreamDeck`, `StreamElements`, `StreamLoots`, `Streamerbot`, `StreamerbotRemote`, `Streamlabs`, `StreamlabsDesktop`, `System`, `TipeeStream`, `TITS`, `TreatStream`, `Twitch`, `Voicemod`, `VTubeStudio`, `WebsocketClient`, `WebsocketCustomServer`, `YouTube`
