#!/usr/bin/env node
/**
 * Streamerbot MCP Server v2
 * Agent-native control of Streamer.bot for streamers who use AI to run their bot.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StreamerbotClient } from "./client";
import { loadConfig } from "./config";
import {
  findActions,
  parseActionsList,
  summarizeGroups,
  summarizeEvents,
  redactSecrets,
} from "./formatters";
import {
  validateSetup,
  describeAutomationGoal,
  getBridgeSetupGuide,
  getImportChecklist,
  resolveEventPreset,
} from "./automation";
import { getActionDetail, loadActionsIndex } from "./actions-index";
import { generateCSharp, listTemplates, type CSharpTemplateId } from "./csharp-templates";
import { AGENT_INSTRUCTIONS, getUiWalkthrough } from "./instructions";
import { ensureConnected, formatError, okText, errText, requireConfirm } from "./tool-helpers";

let client = new StreamerbotClient();
const appConfig = () => client.getConfig();

client.on("error", () => {});

const server = new McpServer({
  name: "streamerbot-mcp",
  version: "2.0.0",
  description:
    "Streamer automation copilot: control Streamer.bot live, plan scene/chat/alert workflows, generate C# scripts. " +
    "Call validate_setup first. Users need not know Streamer.bot — describe goals in plain language.",
});

function tool<T extends Record<string, unknown>>(
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>
) {
  server.tool(name, description, schema, handler as never);
}

// ─── Guide & validation ─────────────────────────────────────────────────────

tool(
  "get_agent_guide",
  "Essential guide for AI agents helping streamers via Streamer.bot. Read this when starting any automation task.",
  {},
  async () => okText({ guide: AGENT_INSTRUCTIONS })
);

tool(
  "validate_setup",
  "Check WebSocket connection, actions, primitives, bridge actions, and subscriptions. Run at the start of every session.",
  {},
  async () => {
    try {
      const result = await validateSetup(client, appConfig());
      return okText(result);
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_ui_walkthrough",
  "Step-by-step Streamer.bot UI instructions for non-technical users. Topics: create_action, add_obs_source_visibility, add_obs_scene_trigger, add_set_global_bridge, import_extension, enable_websocket, enable_http.",
  {
    topic: z
      .string()
      .describe(
        "Walkthrough topic: create_action | add_obs_source_visibility | add_obs_scene_trigger | add_set_global_bridge | import_extension | enable_websocket | enable_http"
      ),
  },
  async ({ topic }) => okText({ topic, steps: getUiWalkthrough(topic) })
);

tool(
  "get_bridge_setup_guide",
  "How to create one-time 'bridge' actions so MCP can set global variables (Streamer.bot has no SetGlobal WebSocket API).",
  {},
  async () => okText(getBridgeSetupGuide(appConfig()))
);

tool(
  "get_import_checklist",
  "Checklist for importing Streamer.bot extensions via UI (applies live, no restart).",
  {
    goal: z.string().optional().describe("What the user is trying to achieve"),
  },
  async ({ goal }) =>
    okText({
      goal: goal ?? "general setup",
      steps: getImportChecklist(goal ?? "automation"),
    })
);

// ─── Connection ─────────────────────────────────────────────────────────────

tool(
  "get_connection_status",
  "Current MCP ↔ Streamer.bot connection state, ports, primitives, and last OBS scene.",
  {},
  async () => okText(client.getConnectionInfo())
);

tool(
  "connect",
  "Connect or reconnect to Streamer.bot WebSocket server.",
  {
    host: z.string().optional(),
    port: z.number().int().optional(),
    password: z.string().optional(),
    http_port: z.number().int().optional(),
  },
  async ({ host, port, password, http_port }) => {
    try {
      client.disconnect();
      client = new StreamerbotClient({
        host,
        wsPort: port,
        password,
        httpPort: http_port,
        autoReconnect: true,
      });
      client.on("error", () => {});
      await client.connect();
      await client.subscribeToAll();
      return okText({
        message: `Connected to ${client.getConnectionInfo().host}:${client.getConnectionInfo().wsPort}`,
        info: client.getConnectionInfo(),
      });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool("disconnect", "Disconnect from Streamer.bot.", {}, async () => {
  client.disconnect();
  return okText({ message: "Disconnected." });
});

tool(
  "get_info",
  "Streamer.bot version, OS, uptime.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getInfo());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_broadcaster",
  "Connected broadcaster accounts (Twitch, YouTube, Kick).",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getBroadcaster());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_active_viewers",
  "Active viewers on connected platforms.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getActiveViewers());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Actions discovery (compact) ────────────────────────────────────────────

tool(
  "list_action_groups",
  "Compact summary of action groups (name, total, enabled, disabled). Use instead of get_actions for planning.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      return okText({ count: actions.length, groups: summarizeGroups(actions) });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "list_actions_in_group",
  "List actions in one group (id, name, enabled, trigger/subaction counts).",
  {
    group: z.string().describe("Exact group name, e.g. Background"),
    include_disabled: z.boolean().default(true),
  },
  async ({ group, include_disabled }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      let actions = parseActionsList(res as Record<string, unknown>).filter(
        (a) => a.group.toLowerCase() === group.toLowerCase()
      );
      if (!include_disabled) actions = actions.filter((a) => a.enabled);
      return okText({ group, count: actions.length, actions });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "find_actions",
  "Search actions by keyword in name or group.",
  {
    query: z.string(),
    group: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ query, group, limit }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = findActions(parseActionsList(res as Record<string, unknown>), query, group).slice(
        0,
        limit
      );
      return okText({ query, count: actions.length, actions });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_action_detail",
  "Action metadata from live API; optional sub-action detail from actions.json if STREAMERBOT_DATA_PATH set and Streamer.bot stopped.",
  {
    action_id_or_name: z.string(),
    from_disk: z
      .boolean()
      .default(false)
      .describe("If true and data path set, include sub-action summary from actions.json (read-only)"),
  },
  async ({ action_id_or_name, from_disk }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      const q = action_id_or_name.toLowerCase();
      const live =
        actions.find((a) => a.id === action_id_or_name) ??
        actions.find((a) => a.name.toLowerCase() === q);
      if (!live) return errText(`Action not found: ${action_id_or_name}`);

      const out: Record<string, unknown> = { live };
      const dataPath = appConfig().dataPath;
      if (from_disk && dataPath) {
        const disk = getActionDetail(dataPath, action_id_or_name);
        out.disk = disk;
        out.diskWarning =
          "Disk index is stale if Streamer.bot is running. Prefer UI edits + do_action for testing.";
      }
      return okText(out);
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_actions",
  "Full action list from Streamer.bot (large). Prefer list_action_groups / find_actions unless you need everything.",
  {
    verbose: z.boolean().default(false).describe("If false, returns compact list only"),
  },
  async ({ verbose }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      if (!verbose) {
        const actions = parseActionsList(res as Record<string, unknown>);
        return okText({ count: actions.length, actions });
      }
      return okText(res);
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "do_action",
  "Run a Streamer.bot action by id or name. Primary way to test automations live (no restart).",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ action_id, action_name, args }) => {
    if (!action_id && !action_name) return errText("Provide action_id or action_name.");
    try {
      await ensureConnected(client);
      const id = action_id ?? action_name!;
      const res = await client.doAction(id, args as Record<string, unknown>, !!action_id);
      return okText(res);
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "do_action_http",
  "Trigger action via HTTP server (port 7474 default). Fire-and-forget; no WebSocket needed.",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ action_id, action_name, args }) => {
    if (!action_id && !action_name) return errText("Provide action_id or action_name.");
    try {
      const id = action_id ?? action_name!;
      const res = await client.doActionHttp(id, args as Record<string, unknown>, !!action_id);
      return okText(res);
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "test_action",
  "Run an action and optionally report recent events (for verifying scene/chat automations).",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    watch_events_seconds: z.number().int().min(0).max(30).default(3),
  },
  async ({ action_id, action_name, args, watch_events_seconds }) => {
    if (!action_id && !action_name) return errText("Provide action_id or action_name.");
    try {
      await ensureConnected(client);
      const before = client.getBufferedEvents(5);
      const id = action_id ?? action_name!;
      const result = await client.doAction(id, args as Record<string, unknown>, !!action_id);
      if (watch_events_seconds > 0) {
        await new Promise((r) => setTimeout(r, watch_events_seconds * 1000));
      }
      const after = client.getBufferedEvents(20);
      return okText({
        doAction: result,
        eventsBefore: before.length,
        recentEvents: summarizeEvents(after),
        currentScene: client.getLastScene(),
      });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "trigger_primitive",
  "Run a configured primitive action (overlay_show, overlay_hide, etc.). Set STREAMERBOT_PRIMITIVES in env.",
  {
    primitive: z.string().describe("Key from primitives config, e.g. overlay_show, overlay_hide"),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ primitive, args }) => {
    const name = appConfig().primitives[primitive];
    if (!name) {
      return errText(
        `Unknown primitive '${primitive}'. Available: ${Object.keys(appConfig().primitives).join(", ")}`
      );
    }
    try {
      await ensureConnected(client);
      const res = await client.doAction(name, args as Record<string, unknown>, false);
      return okText({ primitive, action: name, result: res });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Automation planning ────────────────────────────────────────────────────

tool(
  "describe_automation",
  "Given a goal in plain English, suggest pattern, matching existing actions, and step-by-step plan (UI + MCP).",
  {
    goal: z.string().describe("What the streamer wants, e.g. 'show SE overlay only in ingame scene'"),
  },
  async ({ goal }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      return okText(describeAutomationGoal(goal, actions));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Globals via bridge ─────────────────────────────────────────────────────

tool(
  "set_global_via_action",
  "Set a global variable by running bridge action (create 'MCP Set Global' first — see get_bridge_setup_guide).",
  {
    name: z.string().describe("Global variable name"),
    value: z.union([z.string(), z.number(), z.boolean()]),
    persisted: z.boolean().default(true),
  },
  async ({ name, value, persisted }) => {
    try {
      await ensureConnected(client);
      const actionName = appConfig().bridgeActions.setGlobal;
      const res = await client.doAction(
        actionName,
        { name, value: String(value), persisted: String(persisted) },
        false
      );
      return okText({ action: actionName, variable: name, result: res });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_globals",
  "All global variables. Secrets are redacted.",
  {
    persisted: z.boolean().default(true),
  },
  async ({ persisted }) => {
    try {
      await ensureConnected(client);
      const res = await client.getGlobals(persisted);
      return okText(redactSecrets(res, appConfig()));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_global",
  "Single global variable (redacted if sensitive).",
  {
    variable: z.string(),
    persisted: z.boolean().default(true),
  },
  async ({ variable, persisted }) => {
    try {
      await ensureConnected(client);
      const res = await client.getGlobal(variable, persisted);
      return okText(redactSecrets(res, appConfig()));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Events ─────────────────────────────────────────────────────────────────

tool(
  "get_events",
  "All subscribable event categories and types.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getEvents());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "subscribe_preset",
  "Subscribe to a preset event bundle: streaming, alerts, obs, chat, or all.",
  {
    preset: z.enum(["streaming", "alerts", "obs", "chat", "all"]),
  },
  async ({ preset }) => {
    try {
      await ensureConnected(client);
      const eventsRes = await client.getEvents();
      const events = resolveEventPreset(
        preset,
        (eventsRes.events as Record<string, string[]>) ?? null
      );
      const res = await client.subscribeToEvents(events);
      return okText({ preset, subscribed: Object.keys(events), result: res });
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "subscribe_to_events",
  "Subscribe to specific event categories/types. Use '*' for all types in a category.",
  {
    events: z.record(z.array(z.string())),
  },
  async ({ events }) => {
    try {
      await ensureConnected(client);
      return okText(await client.subscribeToEvents(events));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "subscribe_to_all_events",
  "Subscribe to every event category (dynamic list from Streamer.bot).",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.subscribeToAll());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "unsubscribe_from_events",
  "Unsubscribe from event categories.",
  { events: z.record(z.array(z.string())) },
  async ({ events }) => {
    try {
      await ensureConnected(client);
      return okText(await client.unsubscribeFromEvents(events));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_recent_events",
  "Events from MCP buffer (subscribe first).",
  {
    limit: z.number().int().min(1).max(500).default(50),
    source: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ limit, source, type }) => {
    const events = client.getBufferedEvents(limit, source, type);
    return okText(
      events.length ? events : { message: "No events. Run subscribe_preset or subscribe_to_all_events." }
    );
  }
);

tool(
  "summarize_recent_events",
  "Compact summary of buffered events by source/type.",
  {
    limit: z.number().int().min(1).max(500).default(100),
    source: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ limit, source, type }) => {
    const events = client.getBufferedEvents(limit, source, type);
    return okText(summarizeEvents(events));
  }
);

tool(
  "wait_for_event",
  "Wait up to timeout_ms for an event matching source/type (subscribe first).",
  {
    source: z.string().optional().describe("e.g. Obs, Twitch"),
    type: z.string().optional().describe("e.g. SceneChanged, ChatMessage"),
    timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  },
  async ({ source, type, timeout_ms }) => {
    await ensureConnected(client).catch(() => {});
    const ev = await client.waitForEvent({ source, type, timeoutMs: timeout_ms });
    return okText(ev ?? { message: "No matching event within timeout." });
  }
);

tool(
  "get_current_scene",
  "Last OBS scene from Obs.SceneChanged buffer, or hint to switch scene / subscribe obs preset.",
  {},
  async () => {
    const scene = client.getLastScene();
    return okText({
      scene: scene?.name ?? null,
      timestamp: scene?.timestamp ?? null,
      hint: scene
        ? null
        : "Subscribe subscribe_preset obs, change OBS scene, or wait_for_event source=Obs type=SceneChanged",
    });
  }
);

tool("clear_event_buffer", "Clear MCP event buffer.", {}, async () => {
  client.clearEventBuffer();
  return okText({ cleared: true });
});

tool("get_subscribed_events", "Currently subscribed event categories.", {}, async () =>
  okText(client.getSubscribedEvents())
);

// ─── Code triggers & C# ───────────────────────────────────────────────────────

tool(
  "get_code_triggers",
  "Custom code triggers registered in Streamer.bot.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getCodeTriggers());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "execute_code_trigger",
  "Fire a custom code trigger.",
  {
    trigger_name: z.string(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ trigger_name, args }) => {
    try {
      await ensureConnected(client);
      return okText(await client.executeCodeTrigger(trigger_name, args as Record<string, unknown>));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "list_csharp_templates",
  "List C# script templates the agent can generate for the user to paste into Streamer.bot.",
  {},
  async () => okText({ templates: listTemplates() })
);

tool(
  "generate_csharp_script",
  "Generate a C# Execute Code script + setup steps for Streamer.bot. User pastes into UI — no restart.",
  {
    template: z.enum([
      "set_global",
      "get_global_and_log",
      "obs_scene_router",
      "chat_reply",
      "custom_trigger",
    ]),
    variable_name: z.string().optional(),
    default_value: z.string().optional(),
    persisted: z.boolean().optional(),
    scene_names: z.array(z.string()).optional(),
    overlay_scene: z.string().optional(),
    overlay_source: z.string().optional(),
    trigger_name: z.string().optional(),
    chat_message: z.string().optional(),
  },
  async (params) => {
    const out = generateCSharp(params.template as CSharpTemplateId, {
      variableName: params.variable_name,
      defaultValue: params.default_value,
      persisted: params.persisted,
      sceneNames: params.scene_names,
      overlayScene: params.overlay_scene,
      overlaySource: params.overlay_source,
      triggerName: params.trigger_name,
      chatMessage: params.chat_message,
    });
    return okText(out);
  }
);

tool(
  "inspect_actions_from_disk",
  "Read-only index of actions.json (STREAMERBOT_DATA_PATH). Only when Streamer.bot is stopped.",
  {
    group: z.string().optional(),
    limit: z.number().int().default(50),
  },
  async ({ group, limit }) => {
    const dataPath = appConfig().dataPath;
    if (!dataPath) {
      return errText("Set STREAMERBOT_DATA_PATH to Streamer.bot/data folder for disk index.");
    }
    const { actions, warning } = loadActionsIndex(dataPath);
    let list = actions;
    if (group) list = list.filter((a) => a.group.toLowerCase() === group.toLowerCase());
    return okText({ warning, count: list.length, actions: list.slice(0, limit) });
  }
);

// ─── Commands, credits, chat ──────────────────────────────────────────────────

tool(
  "get_commands",
  "Chat commands defined in Streamer.bot.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getCommands());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_credits",
  "End-of-stream credits data.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getCredits());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "test_credits",
  "Fill credits with test data.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.testCredits());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "clear_credits",
  "Clear all credits. Requires confirm=true.",
  {
    confirm: z.boolean().default(false),
  },
  async ({ confirm }) => {
    const block = requireConfirm(confirm, "clear_credits");
    if (block) return errText(block);
    try {
      await ensureConnected(client);
      return okText(await client.clearCredits());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "send_message",
  "Send chat message on Twitch, Kick, or YouTube. Requires confirm=true.",
  {
    message: z.string().min(1),
    platform: z.enum(["twitch", "kick", "youtube"]),
    bot: z.boolean().default(false),
    internal: z.boolean().default(false),
    confirm: z.boolean().default(false),
  },
  async ({ message, platform, bot, internal, confirm }) => {
    const block = requireConfirm(confirm, "send_message");
    if (block) return errText(block);
    try {
      await ensureConnected(client);
      return okText(await client.sendMessage(message, platform, bot, internal));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Twitch / emotes / pronouns ───────────────────────────────────────────────

tool(
  "twitch_get_user_globals",
  "One user variable across all Twitch users.",
  {
    variable: z.string(),
    persisted: z.boolean().default(true),
  },
  async ({ variable, persisted }) => {
    try {
      await ensureConnected(client);
      return okText(redactSecrets(await client.twitchGetUserGlobals(variable, persisted), appConfig()));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "twitch_get_user_global",
  "User variables for one Twitch user.",
  {
    user_id: z.string(),
    persisted: z.boolean().default(true),
    variable: z.string().optional(),
  },
  async ({ user_id, persisted, variable }) => {
    try {
      await ensureConnected(client);
      return okText(
        redactSecrets(await client.twitchGetUserGlobal(user_id, persisted, variable), appConfig())
      );
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "twitch_get_emotes",
  "Available Twitch emotes.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.twitchGetEmotes());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "youtube_get_emotes",
  "Available YouTube emotes.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.youtubeGetEmotes());
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "get_user_pronouns",
  "Look up user pronouns.",
  {
    user_login: z.string(),
    platform: z.string().default("twitch"),
  },
  async ({ user_login, platform }) => {
    try {
      await ensureConnected(client);
      return okText(await client.getUserPronouns(user_login, platform));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

tool(
  "raw_request",
  "Send arbitrary WebSocket request (advanced).",
  {
    request: z.string(),
    params: z.record(z.unknown()).optional(),
  },
  async ({ request: req, params }) => {
    try {
      await ensureConnected(client);
      const res = await client.sendRequest({ request: req, ...(params ?? {}) } as never);
      return okText(redactSecrets(res, appConfig()));
    } catch (e) {
      return errText(formatError(e));
    }
  }
);

// ─── Resources ───────────────────────────────────────────────────────────────

async function resourceJson(uri: string, fetcher: () => Promise<unknown>): Promise<{
  contents: { uri: string; mimeType: string; text: string }[];
}> {
  try {
    await ensureConnected(client);
    const data = await fetcher();
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
    };
  } catch (e) {
    return {
      contents: [{ uri, mimeType: "text/plain", text: `Error: ${formatError(e)}` }],
    };
  }
}

server.resource("streamerbot-agent-guide", "streamerbot://agent-guide", {
  description: "Agent operating guide for streamer automation",
  mimeType: "text/markdown",
}, async () => ({
  contents: [{ uri: "streamerbot://agent-guide", mimeType: "text/markdown", text: AGENT_INSTRUCTIONS }],
}));

server.resource("streamerbot-info", "streamerbot://info", {
  description: "Instance info",
  mimeType: "application/json",
}, () => resourceJson("streamerbot://info", () => client.getInfo()));

server.resource("streamerbot-actions-summary", "streamerbot://actions-summary", {
  description: "Compact action groups summary",
  mimeType: "application/json",
}, async () => {
  try {
    await ensureConnected(client);
    const res = await client.getActions();
    const actions = parseActionsList(res as Record<string, unknown>);
    return {
      contents: [
        {
          uri: "streamerbot://actions-summary",
          mimeType: "application/json",
          text: JSON.stringify({ count: actions.length, groups: summarizeGroups(actions) }, null, 2),
        },
      ],
    };
  } catch (e) {
    return {
      contents: [{ uri: "streamerbot://actions-summary", mimeType: "text/plain", text: formatError(e) }],
    };
  }
});

server.resource("streamerbot-connection", "streamerbot://connection", {
  description: "Connection status",
  mimeType: "application/json",
}, async () => ({
  contents: [
    {
      uri: "streamerbot://connection",
      mimeType: "application/json",
      text: JSON.stringify(client.getConnectionInfo(), null, 2),
    },
  ],
}));

server.resource("streamerbot-event-buffer", "streamerbot://event-buffer", {
  description: "Recent events summary",
  mimeType: "application/json",
}, async () => ({
  contents: [
    {
      uri: "streamerbot://event-buffer",
      mimeType: "application/json",
      text: JSON.stringify(summarizeEvents(client.getBufferedEvents(200)), null, 2),
    },
  ],
}));

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    await client.connect();
    await client.subscribeToAll();
  } catch {
    /* SB may not be running yet */
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
