# Roadmap — implemented in v2.0.0

This document tracked the improvement plan; **v2.0.0 implements the full plan** below.

## Phase 1 ✅

- WebSocket authentication (OBS-style challenge)
- Fixed `connect` client replacement
- Compact action discovery (`list_action_groups`, `find_actions`, …)
- `validate_setup`, `test_action`
- Dynamic `subscribe_to_all` from `GetEvents`
- Agent guide (`get_agent_guide`, resource `streamerbot://agent-guide`)

## Phase 2 ✅

- `subscribe_preset`, `summarize_recent_events`, `get_current_scene`, `wait_for_event`
- `trigger_primitive`, `set_global_via_action`, bridge setup guide
- `describe_automation`, docs/automation-patterns.md

## Phase 3 ✅

- `generate_csharp_script`, `list_csharp_templates`
- `get_ui_walkthrough`, `get_import_checklist`
- `inspect_actions_from_disk` (STREAMERBOT_DATA_PATH)

## Phase 4 ✅

- HTTP `do_action_http`
- Secret redaction on globals
- `confirm` on `send_message`, `clear_credits`
- live-dev-workflow.md, templates/

## Future ideas

- Official Import API if Streamer.bot adds one
- MCP prompts for common streamer goals
- Integration tests with mock WebSocket server
