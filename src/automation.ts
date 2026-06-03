import type { StreamerbotClient } from "./client";
import type { AppConfig } from "./config";
import { EVENT_PRESETS } from "./config";
import {
  findActions,
  parseActionsList,
  summarizeGroups,
  type ActionSummary,
} from "./formatters";

export interface ValidationResult {
  ok: boolean;
  connected: boolean;
  checks: Array<{ name: string; pass: boolean; message: string }>;
  hints: string[];
}

export async function validateSetup(
  client: StreamerbotClient,
  config: AppConfig
): Promise<ValidationResult> {
  const checks: ValidationResult["checks"] = [];
  const hints: string[] = [
    "You do not need to edit actions.json — use Streamer.bot UI or Import, then test with do_action.",
    "Tell the AI your goal in plain language; it will use primitives, bridge actions, or C# templates.",
  ];

  let connected = false;
  try {
    await client.connect();
    connected = client.isConnected;
    checks.push({
      name: "websocket",
      pass: connected,
      message: connected
        ? `Connected to ${config.host}:${config.wsPort}`
        : "Not connected — start Streamer.bot and enable WebSocket Server (Servers/Clients)",
    });
  } catch (e) {
    checks.push({
      name: "websocket",
      pass: false,
      message: String(e),
    });
  }

  if (connected) {
    try {
      await client.getInfo();
      checks.push({ name: "get_info", pass: true, message: "Streamer.bot responded to GetInfo" });
    } catch (e) {
      checks.push({ name: "get_info", pass: false, message: String(e) });
    }

    try {
      const actionsRes = await client.getActions();
      const actions = parseActionsList(actionsRes as Record<string, unknown>);
      checks.push({
        name: "actions_loaded",
        pass: actions.length > 0,
        message: `${actions.length} actions available`,
      });

      for (const [key, actionName] of Object.entries(config.primitives)) {
        const found = actions.find(
          (a) => a.name.toLowerCase() === actionName.toLowerCase()
        );
        checks.push({
          name: `primitive_${key}`,
          pass: !!found,
          message: found
            ? `Primitive "${actionName}" found`
            : `Optional primitive "${actionName}" not found — create in Background group or set STREAMERBOT_PRIMITIVES`,
        });
      }

      const bridge = config.bridgeActions.setGlobal;
      const bridgeFound = actions.some((a) => a.name === bridge);
      checks.push({
        name: "bridge_set_global",
        pass: bridgeFound,
        message: bridgeFound
          ? `Bridge action "${bridge}" found`
          : `Create action "${bridge}" with Set Global Variable sub-action (see get_bridge_setup_guide)`,
      });
    } catch (e) {
      checks.push({ name: "actions_loaded", pass: false, message: String(e) });
    }

    const subs = client.getSubscribedEvents();
    checks.push({
      name: "event_subscription",
      pass: Object.keys(subs).length > 0,
      message:
        Object.keys(subs).length > 0
          ? `Subscribed to ${Object.keys(subs).length} categories`
          : "Run subscribe_to_all_events or subscribe_preset",
    });
  }

  if (config.dataPath) {
    hints.push(`Data path set: ${config.dataPath} (read-only index when SB is stopped)`);
  }

  const ok = checks.every((c) => c.pass || c.name.startsWith("primitive_"));
  return { ok, connected, checks, hints };
}

export function describeAutomationGoal(
  goal: string,
  actions: ActionSummary[]
): {
  goal: string;
  suggestedPattern: string;
  existingMatches: ActionSummary[];
  recommendedSteps: string[];
  primitivesToCreate?: string[];
} {
  const g = goal.toLowerCase();
  let pattern = "general_action";
  const steps: string[] = [];
  const primitives: string[] = [];

  if (/scene|obs|overlay|ingame|beat saber/i.test(g)) {
    pattern = "scene_router";
    steps.push(
      "1. Create primitive actions: SE Overlay Show / Hide (OBS → Set Source Visibility on ingame/streamelementsoverlay)",
      "2. Parent action 'scene changed' trigger: OBS → Current Program Scene Changed",
      "3. On every scene change: run Hide first, then If scene == ingame → run Scene ingame (Show + your other steps)",
      "4. Test with MCP: do_action scene changed, subscribe_preset obs, get_current_scene",
    );
    primitives.push("SE Overlay Show", "SE Overlay Hide");
  } else if (/alert|follow|sub|cheer|donat/i.test(g)) {
    pattern = "alert_chain";
    steps.push(
      "1. Use a blocking Action Queue for alerts so they play one at a time",
      "2. One action per alert type with Trigger: Twitch → Follow/Sub/etc.",
      "3. subscribe_preset alerts to monitor events in MCP",
    );
  } else if (/command|chat|!\\w+/i.test(g)) {
    pattern = "chat_command";
    steps.push(
      "1. Commands tab: add command trigger word",
      "2. Link command to an action with sub-actions",
      "3. Or use send_message / chat_reply C# template for bot replies",
    );
  } else if (/global|variable|counter|state/i.test(g)) {
    pattern = "global_state";
    steps.push(
      "1. Create bridge action 'MCP Set Global' (Set Global Variable sub-action using %name% %value% args)",
      "2. Or generate_csharp_script template set_global",
      "3. Use set_global_via_action from MCP to update without restart",
    );
  } else {
    steps.push(
      "1. find_actions / list_action_groups to see what already exists",
      "2. do_action to test an existing action",
      "3. generate_csharp_script if custom logic is needed",
      "4. User adds sub-actions in Streamer.bot UI (live, no restart) — AI guides steps",
    );
  }

  const keywords = goal.split(/\s+/).filter((w) => w.length > 3);
  let matches = actions;
  for (const kw of keywords.slice(0, 5)) {
    const m = findActions(actions, kw);
    if (m.length) matches = m;
  }
  matches = matches.slice(0, 15);

  return {
    goal,
    suggestedPattern: pattern,
    existingMatches: matches,
    recommendedSteps: steps,
    primitivesToCreate: primitives.length ? primitives : undefined,
  };
}

export function getBridgeSetupGuide(config: AppConfig): {
  bridgeActions: AppConfig["bridgeActions"];
  actions: Array<{
    name: string;
    purpose: string;
    subActions: string[];
    argsForDoAction?: Record<string, string>;
  }>;
  importNote: string;
} {
  return {
    bridgeActions: config.bridgeActions,
    actions: [
      {
        name: config.bridgeActions.setGlobal,
        purpose: "Lets MCP set globals without a direct WebSocket API",
        subActions: [
          "Core → Globals → Set Global Variable",
          "Variable: %name% (or fixed name)",
          "Value: %value%",
          "Type: Persisted or Non-Persisted from %persisted%",
        ],
        argsForDoAction: {
          name: "variable name",
          value: "new value",
          persisted: "true or false",
        },
      },
      {
        name: config.bridgeActions.setUserGlobal,
        purpose: "Set per-user Twitch variable from MCP",
        subActions: [
          "Core → Globals → Set Global Variable → User scope",
          "Use %userId% %variable% %value% from args",
        ],
        argsForDoAction: {
          userId: "Twitch numeric user id",
          variable: "variable name",
          value: "value",
        },
      },
    ],
    importNote:
      "Create these once in Streamer.bot UI. Changes apply live — no restart. MCP calls do_action with args.",
  };
}

export function getImportChecklist(goal: string): string[] {
  return [
    "Open Streamer.bot → toolbar → Import",
    "Paste import string (from community or AI-generated export)",
    "Review items — Right-click to Include/Exclude and Overwrite",
    "Confirm OBS source/scene names match your setup (ingame, streamelementsoverlay, etc.)",
    "Click Import — applies immediately without restart",
    `Goal context: ${goal}`,
    "Run validate_setup via MCP to confirm actions exist",
    "Test with test_action / do_action",
  ];
}

export function resolveEventPreset(
  preset: string,
  cachedEvents: Record<string, string[]> | null
): Record<string, string[]> {
  if (preset === "all" && cachedEvents) {
    const out: Record<string, string[]> = {};
    for (const cat of Object.keys(cachedEvents)) out[cat] = ["*"];
    return out;
  }
  const p = EVENT_PRESETS[preset];
  if (p && Object.keys(p).length > 0) return p;
  if (cachedEvents) {
    const out: Record<string, string[]> = {};
    for (const cat of Object.keys(cachedEvents)) out[cat] = ["*"];
    return out;
  }
  return EVENT_PRESETS.obs;
}
