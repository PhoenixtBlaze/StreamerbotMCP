/**
 * Agent-facing guide embedded in MCP server metadata and get_agent_guide tool.
 */

export const AGENT_INSTRUCTIONS = `# Streamerbot MCP — Agent Operating Guide

You are helping a streamer who may never open Streamer.bot themselves. Your job is to achieve their goal using MCP tools and clear UI steps they can follow if needed.

## Golden rules

1. **Never edit actions.json while Streamer.bot is running** — it will not reload. Use Streamer.bot UI (live) or Import, then test with \`do_action\`.
2. **Prefer runtime tools**: \`do_action\`, \`execute_code_trigger\`, \`set_global_via_action\`, \`send_message\`.
3. **Discover before dumping**: \`list_action_groups\` → \`find_actions\` → \`get_action_detail\` (not full get_actions unless necessary).
4. **Start with** \`validate_setup\` when beginning a session.
5. **Plain language for the user** — explain what you did in one sentence, not WebSocket jargon.

## Typical workflows

### "When X happens, do Y"
- find_actions for existing triggers
- If missing: guide user to add Trigger in UI OR use \`generate_csharp_script\` + \`get_ui_walkthrough\`
- Wire: OBS/Twitch trigger → action → sub-actions
- Test: \`test_action\`, \`wait_for_event\`, \`subscribe_preset\`

### Scene / overlay (e.g. show overlay in ingame only)
- Pattern: scene_router — primitives Show/Hide + parent "scene changed"
- \`describe_automation\` for plan
- \`trigger_primitive\` overlay_show / overlay_hide for tests

### Chat / commands
- get_commands, do_action on command's action
- send_message for bot chat

### Variables / state
- set_global_via_action (requires bridge action — see get_bridge_setup_guide)
- generate_csharp_script set_global

## Tools cheat sheet

| User wants | Use |
|------------|-----|
| See what exists | list_action_groups, find_actions |
| Run something | do_action, trigger_primitive, test_action |
| Watch stream | subscribe_preset, wait_for_event, summarize_recent_events |
| Current OBS scene | get_current_scene |
| Fix connection | connect, validate_setup |
| Custom logic | generate_csharp_script, get_ui_walkthrough |
| Plan automation | describe_automation |

## C# scripts

When sub-actions are not enough, use \`generate_csharp_script\`. User pastes into Streamer.bot → Sub-Actions → C# → Execute C# Code → Compile. No restart needed.

## What MCP cannot do

- Create/edit action definitions remotely (no API) — user UI or Import only
- Set globals directly — use bridge action or C# 
`;

export function getUiWalkthrough(topic: string): string[] {
  const steps: Record<string, string[]> = {
    create_action: [
      "Open Streamer.bot → Actions & Queues → Actions",
      "Right-click in the left pane → Add",
      "Enter Name and Group (e.g. Background), keep Enabled on → OK",
    ],
    add_obs_source_visibility: [
      "Select your action in the left pane",
      "Right-click in Sub-Actions pane (right side) → OBS → Sources → Set Source Visibility State",
      "Pick OBS connection, Scene name, Source name",
      "Set Visible or Hidden → Save",
    ],
    add_obs_scene_trigger: [
      "Select your action",
      "In Triggers pane (middle): Right-click → Add → OBS → Scene → Scene Changed (or Current Program Scene Changed)",
      "Configure scene filter if needed",
    ],
    add_set_global_bridge: [
      "Create action named 'MCP Set Global' (or name from get_bridge_setup_guide)",
      "Sub-Action: Core → Globals → Set Global Variable",
      "Variable name: %name%  Value: %value%  (use exact argument names from bridge guide)",
      "Save — MCP can call do_action with args name, value, persisted",
    ],
    import_extension: [
      "Toolbar → Import",
      "Paste UUEncoded string → review items → Import",
      "Applies immediately — no restart",
    ],
    enable_websocket: [
      "Servers/Clients → WebSocket Server → set Port (e.g. 8080) → Start",
      "If password enabled, set STREAMERBOT_PASSWORD in MCP env",
    ],
    enable_http: [
      "Servers/Clients → HTTP Server → Auto Start optional → Port 7474 → Start",
    ],
  };
  return (
    steps[topic] ?? [
      "Available topics: create_action, add_obs_source_visibility, add_obs_scene_trigger, add_set_global_bridge, import_extension, enable_websocket, enable_http",
    ]
  );
}
