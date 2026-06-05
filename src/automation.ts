import type { StreamerbotClient } from "./client";
import type { AppConfig } from "./config";
import { EVENT_PRESETS } from "./config";
import { checkHttpServer } from "./http-status";
import {
  compactActions,
  findActions,
  parseActionsList,
  scoreTextMatch,
  summarizeGroups,
  type ActionSummary,
} from "./formatters";

export interface ValidationResult {
  ok: boolean;
  connected: boolean;
  http_available: boolean;
  recommended_next: string;
  checks: Array<{ name: string; pass: boolean; message: string }>;
  hints: string[];
}

const PATTERNS: Record<string, Array<{ keywords: string[]; weight: number }>> = {
  scene_router: [
    { keywords: ["scene", "obs"], weight: 2 },
    { keywords: ["overlay", "show", "hide", "visibility", "source"], weight: 1 },
    { keywords: ["ingame", "game scene", "when scene", "switch scene"], weight: 3 },
  ],
  alert_chain: [
    { keywords: ["alert", "follow", "sub", "cheer", "donate", "tip"], weight: 2 },
    { keywords: ["raid", "gift", "redemption", "reward"], weight: 1 },
  ],
  chat_command: [
    { keywords: ["command", "!cmd", "chat bot", "reply", "respond"], weight: 2 },
    { keywords: ["bot say", "message trigger"], weight: 3 },
  ],
  global_state: [
    { keywords: ["variable", "global", "counter", "state", "persist"], weight: 2 },
    { keywords: ["remember", "store", "track", "keep", "save value"], weight: 2 },
  ],
  timed_event: [
    { keywords: ["every", "timer", "interval", "schedule", "minutes", "hours"], weight: 2 },
    { keywords: ["repeat", "periodic", "reminder", "countdown"], weight: 1 },
  ],
};

const PATTERN_STEPS: Record<string, string[]> = {
  scene_router: [
    "Create primitive actions: overlay Show / Hide (OBS → Set Source Visibility)",
    "Parent action with OBS → Current Program Scene Changed trigger",
    "On scene change: Hide first, then If scene matches target → Show overlay",
    "Test: trigger_primitive, subscribe_preset obs, get_current_scene",
  ],
  alert_chain: [
    "Use a blocking Action Queue so alerts play one at a time",
    "One action per alert type with Twitch trigger (Follow/Sub/Cheer/etc.)",
    "subscribe_preset alerts to monitor events in MCP",
  ],
  chat_command: [
    "Commands tab: add command trigger word",
    "Link command to an action with sub-actions",
    "Or use send_message / chat_reply C# template for bot replies",
  ],
  global_state: [
    "Create bridge action 'MCP Set Global' (Set Global Variable sub-action using %name% %value% args)",
    "Or generate_csharp_script template set_global",
    "Use set_global_via_action from MCP to update without restart",
  ],
  timed_event: [
    "Actions & Queues → Timers — add a timed trigger",
    "Link to action",
    "Test: do_action with args, then subscribe_preset streaming to watch",
  ],
  unclear: [
    "Rephrase your goal with keywords: scene, alert, command, variable, or timer",
    "Or call get_agent_guide section=workflows for pattern examples",
  ],
};

function normalizeGoal(goal: string): string {
  return goal.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function scorePatterns(goal: string): Array<{ pattern: string; score: number; matched: string[] }> {
  const normalized = normalizeGoal(goal);
  const results: Array<{ pattern: string; score: number; matched: string[] }> = [];

  for (const [pattern, bags] of Object.entries(PATTERNS)) {
    let score = 0;
    const matched: string[] = [];
    for (const bag of bags) {
      for (const kw of bag.keywords) {
        if (normalized.includes(kw)) {
          score += bag.weight;
          matched.push(kw);
        }
      }
    }
    results.push({ pattern, score, matched: [...new Set(matched)] });
  }

  return results.sort((a, b) => b.score - a.score);
}

function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function scoreActions(actions: ActionSummary[], goal: string): ActionSummary[] {
  return actions
    .map((a) => ({
      action: a,
      score: scoreTextMatch(`${a.name} ${a.group}`, goal),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((x) => x.action);
}

export function describeAutomationGoal(
  goal: string,
  actions: ActionSummary[]
): {
  goal: string;
  pattern: string;
  matched_keywords: string[];
  confidence: "high" | "medium" | "low";
  existing_matches: ActionSummary[];
  steps: string[];
  primitives_needed?: string[];
  csharp_templates?: string[];
  hint?: string;
} {
  const scored = scorePatterns(goal);
  const top = scored[0];
  const secondScore = scored[1]?.score ?? 0;

  let pattern = top?.pattern ?? "unclear";
  let matched_keywords = top?.matched ?? [];
  let score = top?.score ?? 0;

  if (score < 2) {
    pattern = "unclear";
    matched_keywords = [];
  }

  const confidence = pattern === "unclear" ? "low" : confidenceFromScore(score);
  const steps = [...(PATTERN_STEPS[pattern] ?? PATTERN_STEPS.unclear)];

  const primitives_needed =
    pattern === "scene_router" ? ["overlay_show", "overlay_hide"] : undefined;
  const csharp_templates =
    pattern === "global_state"
      ? ["set_global"]
      : pattern === "chat_command"
        ? ["chat_reply"]
        : pattern === "scene_router"
          ? ["obs_scene_router"]
          : undefined;

  const existing_matches = compactActions(scoreActions(actions, goal));

  const result: ReturnType<typeof describeAutomationGoal> = {
    goal,
    pattern,
    matched_keywords,
    confidence,
    existing_matches,
    steps,
    primitives_needed,
    csharp_templates,
  };

  if (confidence === "low") {
    result.hint = "Consider calling get_agent_guide workflows section for pattern examples.";
  } else if (secondScore > 0 && top.score - secondScore <= 1) {
    result.hint = `Pattern ${pattern} selected (${matched_keywords.join(", ")}). Similar: ${scored[1].pattern}.`;
  }

  return result;
}

function deriveRecommendedNext(result: ValidationResult): string {
  if (!result.connected) return "connect";
  if (!result.http_available) return "get_ui_walkthrough enable_http";
  const subs = result.checks.find((c) => c.name === "event_subscription");
  if (subs && !subs.pass) return "subscribe_preset streaming";
  const bridge = result.checks.find((c) => c.name === "bridge_set_global");
  if (bridge && !bridge.pass) return "get_bridge_setup_guide";
  return "list_action_groups";
}

export async function validateSetup(
  client: StreamerbotClient,
  config: AppConfig
): Promise<ValidationResult> {
  const checks: ValidationResult["checks"] = [];
  const hints: string[] = [
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
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const httpStatus = await checkHttpServer(config.host, config.httpPort);
  checks.push({
    name: "http_server",
    pass: httpStatus.available,
    message: httpStatus.available
      ? `HTTP server reachable on port ${config.httpPort} (${httpStatus.latency_ms}ms)`
      : `HTTP server not reachable on port ${config.httpPort} — enable in Servers/Clients for do_action_http`,
  });

  if (connected) {
    try {
      await client.getInfo();
      checks.push({ name: "get_info", pass: true, message: "Streamer.bot responded to GetInfo" });
    } catch (e) {
      checks.push({
        name: "get_info",
        pass: false,
        message: e instanceof Error ? e.message : String(e),
      });
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
        const found = actions.find((a) => a.name.toLowerCase() === actionName.toLowerCase());
        checks.push({
          name: `primitive_${key}`,
          pass: !!found,
          message: found
            ? `Primitive "${actionName}" found`
            : `Optional primitive "${actionName}" not found — set STREAMERBOT_PRIMITIVES`,
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
      checks.push({
        name: "actions_loaded",
        pass: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const subs = client.getSubscribedEvents();
    checks.push({
      name: "event_subscription",
      pass: Object.keys(subs).length > 0,
      message:
        Object.keys(subs).length > 0
          ? `Subscribed to ${Object.keys(subs).length} categories`
          : "Run subscribe_preset streaming or subscribe_to_all_events",
    });
  }

  if (config.dataPath) {
    hints.push(`Data path set (read-only index when SB is stopped)`);
  }

  const ok = checks.every((c) => c.pass || c.name.startsWith("primitive_"));
  const partial: ValidationResult = {
    ok,
    connected,
    http_available: httpStatus.available,
    recommended_next: "",
    checks,
    hints,
  };
  partial.recommended_next = deriveRecommendedNext(partial);
  return partial;
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
    "Confirm OBS source/scene names match your setup",
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
