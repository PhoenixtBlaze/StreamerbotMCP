# StreamerbotMCP v3 — Product Requirements Document

**Project:** [PhoenixtBlaze/StreamerbotMCP](https://github.com/PhoenixtBlaze/StreamerbotMCP)  
**Version:** 3.0.0  
**Status:** Implemented (June 2026)

This document defines the v3 rewrite. See `src/` for the implementation:

| Module | Purpose |
|--------|---------|
| `safety.ts` | Destructive op registry, universal secret redaction |
| `http-status.ts` | HTTP server health check |
| `tool-helpers.ts` | `classifyError`, `okText`/`errText`, confirm gates |
| `automation.ts` | Keyword-scored `describe_automation`, expanded `validate_setup` |
| `instructions.ts` | Structured `AGENT_INSTRUCTIONS` (<600 tokens) |
| `formatters.ts` | Compact payloads, event summaries, broadcaster/commands/globals |

## Acceptance criteria (verified)

Run `node scripts/validate-v3.js` after `npm run build`:

- All tool descriptions ≤160 characters
- `AGENT_INSTRUCTIONS` under ~600 tokens
- `do_action` ↔ `test_action` cross-references in descriptions
- `validate_setup` includes `http_available` and `recommended_next`
- New tools: `get_http_status`, `list_event_categories`, `check_action_exists`
- MCP prompts: `scene_overlay_router`, `alert_chain_setup`, `chat_command_setup`
- Resources: `streamerbot://http-status`, updated connection/actions-summary

For the full PRD specification (tool-by-tool behavior, error codes, pattern engine), refer to the v3 planning document used at implementation time.
