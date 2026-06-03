# Streamer.bot automation patterns (for agents)

Use these patterns when a streamer describes a goal in plain language.

## 1. Scene router (OBS)

**User says:** “Show overlay in ingame, hide everywhere else including Beat Saber.”

**Structure:**

```
Trigger: OBS → Current Program Scene Changed
  → Hide overlay (always)
  → If scene == ingame → Run "Scene ingame" (show overlay + other steps)
  → If scene == Beat Saber → Run "Scene Beat Saber" (optional extra steps)
```

**MCP:** `describe_automation`, `trigger_primitive overlay_hide/show`, `test_action` on `scene changed`, `get_current_scene`.

**Primitives (create once in Background):**

- `SE Overlay Show` — OBS Set Source Visibility, ingame / streamelementsoverlay / visible  
- `SE Overlay Hide` — same source / hidden  

Env: `STREAMERBOT_PRIMITIVES={"overlay_show":"SE Overlay Show","overlay_hide":"SE Overlay Hide"}`

---

## 2. Alert chain

**User says:** “Play alerts one at a time.”

**Structure:** Blocking action queue; one action per alert type; Twitch/SE triggers.

**MCP:** `subscribe_preset alerts`, `find_actions` for existing alert actions.

---

## 3. Chat command

**User says:** “When someone types !points, show their points.”

**Structure:** Commands tab → trigger → action with Get User Global + Send Message.

**MCP:** `get_commands`, `do_action`, `send_message` (with confirm), or `generate_csharp_script` chat_reply.

---

## 4. Global state / counters

**User says:** “Track wins in a variable.”

**Structure:** Bridge action or C# `CPH.SetGlobalVar`; read with Get Global Variable sub-action.

**MCP:** `set_global_via_action`, `get_global`, `generate_csharp_script set_global`.

---

## 5. Custom code trigger

**User says:** “Let my overlay call Streamer.bot from a browser.”

**Structure:** RegisterCustomTrigger in startup action; WebSocket custom server or overlay fetch.

**MCP:** `execute_code_trigger`, `generate_csharp_script custom_trigger`.

---

## Anti-patterns

- Dumping full `get_actions` for every question — use `list_action_groups` / `find_actions`.  
- Patching `actions.json` while Streamer.bot is open.  
- Expecting MCP to create actions without user UI or Import.
