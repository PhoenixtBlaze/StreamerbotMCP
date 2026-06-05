/**
 * Agent-facing guide — structured for section-level retrieval (<600 tokens full).
 */

export interface AgentInstructions {
  rules: string[];
  workflows: Record<string, string>;
  cheatsheet: Record<string, string>;
  limits: string[];
}

export const AGENT_INSTRUCTIONS: AgentInstructions = {
  rules: [
    "Never edit actions.json while Streamer.bot is running.",
    "Run validate_setup at session start.",
    "Discover before running: list_action_groups → find_actions → do_action.",
    "Use test_action (not do_action) when you need to verify an automation worked.",
    "All destructive tools require confirm=true.",
    "Explain actions to the user in plain language — no WS jargon.",
  ],
  workflows: {
    scene_overlay:
      "describe_automation → trigger_primitive overlay_show/hide → test_action → subscribe_preset obs → get_current_scene",
    alert: "describe_automation → subscribe_preset alerts → wait_for_event → test_action",
    chat_command: "get_commands → do_action on command action → send_message (confirm=true)",
    global_state: "get_bridge_setup_guide → set_global_via_action OR generate_csharp_script set_global",
    timed: "describe_automation → get_ui_walkthrough create_action → do_action to test",
  },
  cheatsheet: {
    "See what exists": "list_action_groups, find_actions",
    "Run something": "do_action, trigger_primitive",
    "Verify it worked": "test_action, wait_for_event, summarize_recent_events",
    "Current OBS scene": "get_current_scene",
    "Fix connection": "connect, validate_setup",
    "Custom logic": "generate_csharp_script, get_ui_walkthrough",
    "Plan automation": "describe_automation",
    "Check HTTP": "get_http_status",
  },
  limits: [
    "Cannot create/edit action definitions remotely (Streamer.bot has no write API).",
    "Cannot set globals without a bridge action (see get_bridge_setup_guide).",
    "Disk index (inspect_actions_from_disk) is only safe when Streamer.bot is stopped.",
  ],
};

export type AgentGuideSection = keyof AgentInstructions;

export function getAgentGuideSection(
  section?: AgentGuideSection
): AgentInstructions | AgentInstructions[AgentGuideSection] {
  if (!section) return AGENT_INSTRUCTIONS;
  return AGENT_INSTRUCTIONS[section];
}

const WALKTHROUGH_MINUTES: Record<string, number> = {
  create_action: 2,
  add_obs_source_visibility: 3,
  add_obs_scene_trigger: 3,
  add_set_global_bridge: 5,
  import_extension: 3,
  enable_websocket: 2,
  enable_http: 2,
};

export function getUiWalkthrough(topic: string): { steps: string[]; estimated_minutes: number } {
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

  const list = steps[topic] ?? [
    "Available topics: create_action, add_obs_source_visibility, add_obs_scene_trigger, add_set_global_bridge, import_extension, enable_websocket, enable_http",
  ];
  return {
    steps: list,
    estimated_minutes: WALKTHROUGH_MINUTES[topic] ?? 3,
  };
}
