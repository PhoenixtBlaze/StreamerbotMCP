# Template: Scene-based StreamElements overlay

## Goal

Show `streamelementsoverlay` when OBS scene is **ingame**; hide on **Beat Saber** and all other scenes.

## One-time setup in Streamer.bot (user or guided by agent)

### Primitives (group: Background)

1. **SE Overlay Hide**  
   - Sub-action: OBS → Set Source Visibility  
   - Scene: `ingame` | Source: `streamelementsoverlay` | Hidden  

2. **SE Overlay Show**  
   - Same scene/source | Visible  

### Parent action: `scene changed`

- Trigger: OBS → **Current Program Scene Changed**  
- Sub-actions (order matters):  
  1. (Optional) OBS context sub-action if you already use one  
  2. **Run SE Overlay Hide** (or inline hide sub-action)  
  3. If `%currentScene%` == `ingame` → Run action **Scene ingame**  
  4. If `%currentScene%` == `Beat Saber` → Run **Scene Beat Saber**  
  5. Other scenes: overlay stays hidden  

### Child: `Scene ingame`

- Include **SE Overlay Show** (and your other ingame-only steps).  

## MCP testing (no restart)

```text
validate_setup
subscribe_preset obs
trigger_primitive overlay_show
trigger_primitive overlay_hide
test_action action_name=scene changed
get_current_scene
```

## C# alternative

`generate_csharp_script` template `obs_scene_router` with `overlay_scene=ingame`, `overlay_source=streamelementsoverlay`.
