# Live development workflow (no Streamer.bot restart)

Streamer.bot keeps actions **in memory**. The WebSocket API can **run** actions but cannot **create** them.

## What applies immediately

| Method | Restart? |
|--------|----------|
| Edit action in Streamer.bot UI | No |
| Import (toolbar → Import) | No |
| `do_action` / `test_action` via MCP | No |
| `generate_csharp_script` → paste in UI → Compile | No |
| `set_global_via_action` (bridge action) | No |

## What requires restart

| Method | Restart? |
|--------|----------|
| Editing `data/actions.json` on disk while SB is closed | Yes (on next start) |
| Editing `actions.json` while SB is running | **Avoid** — changes ignored until restart |

## Recommended loop for AI + streamer

1. `validate_setup` — connection and optional primitives.
2. `describe_automation` — plan from the user’s goal in plain English.
3. User creates or adjusts actions in UI (agent gives `get_ui_walkthrough` steps).
4. `test_action` / `trigger_primitive` — verify live.
5. `subscribe_preset obs` + `get_current_scene` — verify scene routing.

## Bridge actions (one-time)

Create **MCP Set Global** in UI so MCP can set variables:

- Sub-action: Core → Globals → Set Global Variable  
- Variable: `%name%` Value: `%value%`  

Then: `set_global_via_action` from MCP.

See `get_bridge_setup_guide` tool.
