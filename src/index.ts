#!/usr/bin/env node
/**
 * Streamerbot MCP Server v3
 * Agent-native control of Streamer.bot for streamers who use AI to run their bot.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StreamerbotClient } from "./client";
import { loadConfig } from "./config";
import {
  findActions,
  findActionExact,
  parseActionsList,
  summarizeGroups,
  summarizeEvents,
  compactActions,
  compactAction,
  formatBroadcaster,
  formatCommands,
  formatGlobals,
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
import { AGENT_INSTRUCTIONS, getAgentGuideSection, getUiWalkthrough } from "./instructions";
import { checkHttpServer } from "./http-status";
import { ensureConnected, okText, errText, requireConfirm, catchErr } from "./tool-helpers";

let client = new StreamerbotClient();
const cfg = () => client.getConfig();

client.on("error", () => {});

const server = new McpServer({
  name: "streamerbot-mcp",
  version: "3.0.0",
  description:
    "Streamer automation copilot: control Streamer.bot live, plan scene/chat/alert workflows, generate C# scripts. " +
    "Call validate_setup first.",
});

function tool<T extends Record<string, unknown>>(
  name: string,
  description: string,
  schema: T,
  handler: (args: z.infer<z.ZodObject<T>>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>
) {
  server.tool(name, description, schema, handler as never);
}

const TEMPLATE_IDS = [
  "set_global",
  "get_global_and_log",
  "obs_scene_router",
  "chat_reply",
  "custom_trigger",
] as const;

// ─── Guide & validation ─────────────────────────────────────────────────────

tool(
  "get_agent_guide",
  "Operating guide for Streamer.bot automation. Call once per session if unfamiliar with available patterns.",
  {
    section: z
      .enum(["rules", "workflows", "cheatsheet", "limits"])
      .optional()
      .describe("Return only this section to save tokens"),
  },
  async ({ section }) => okText(getAgentGuideSection(section), cfg())
);

tool(
  "validate_setup",
  "Full session health check: connection, HTTP server, actions, primitives, bridge action, subscriptions. Run first every session.",
  {},
  async () => {
    try {
      return okText(await validateSetup(client, cfg()), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_ui_walkthrough",
  "Step-by-step Streamer.bot UI instructions for one topic. Valid topics are listed in the topic parameter schema.",
  {
    topic: z
      .string()
      .describe(
        "create_action | add_obs_source_visibility | add_obs_scene_trigger | add_set_global_bridge | import_extension | enable_websocket | enable_http"
      ),
  },
  async ({ topic }) => {
    const walk = getUiWalkthrough(topic);
    return okText({ topic, ...walk }, cfg());
  }
);

tool(
  "get_bridge_setup_guide",
  "How to create bridge actions for set_global_via_action. Streamer.bot has no SetGlobal WS API — these one-time actions are required.",
  {},
  async () => okText(getBridgeSetupGuide(cfg()), cfg())
);

tool(
  "get_import_checklist",
  "Checklist for importing Streamer.bot extensions via UI. Pass goal to get context-relevant tips.",
  {
    goal: z.string().optional().describe("What the user is trying to achieve"),
  },
  async ({ goal }) =>
    okText({ steps: getImportChecklist(goal ?? "automation") }, cfg())
);

tool(
  "get_http_status",
  "Check if Streamer.bot HTTP server is running. Required before do_action_http. Also returned by validate_setup.",
  {},
  async () => {
    const c = cfg();
    const status = await checkHttpServer(c.host, c.httpPort);
    return okText(status, cfg());
  }
);

// ─── Connection ─────────────────────────────────────────────────────────────

tool(
  "get_connection_status",
  "Current WS + HTTP connection state and last OBS scene. Prefer validate_setup for full session context.",
  {},
  async () => {
    const c = cfg();
    const http = await checkHttpServer(c.host, c.httpPort);
    return okText({ ...client.getConnectionInfo(), http_available: http.available }, cfg());
  }
);

tool(
  "connect",
  "Connect/reconnect to Streamer.bot WS server. Call only if validate_setup reports disconnected.",
  {
    host: z.string().optional(),
    port: z.number().int().optional().describe("WebSocket port (default from env)"),
    password: z.string().optional(),
    http_port: z.number().int().optional().describe("HTTP port for do_action_http (default 7474)"),
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
      const c = client.getConfig();
      const http = await checkHttpServer(c.host, c.httpPort);
      return okText(
        {
          connected: true,
          host: c.host,
          wsPort: c.wsPort,
          httpPort: c.httpPort,
          http_available: http.available,
        },
        cfg()
      );
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "disconnect",
  "Disconnect MCP from Streamer.bot WS. Only needed to switch hosts or close session gracefully.",
  {},
  async () => okText({ disconnected: true }, cfg())
);

tool(
  "get_info",
  "Streamer.bot version, OS, uptime. Use only when version matters; validate_setup includes this.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getInfo(), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_broadcaster",
  "Connected broadcaster accounts (Twitch/YouTube/Kick). Streamer.bot must be connected to a platform first.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      const raw = (await client.getBroadcaster()) as Record<string, unknown>;
      return okText(formatBroadcaster(raw), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_active_viewers",
  "Active viewers on connected platforms. Returns empty if no active stream or no platform connected.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      const res = await client.getActiveViewers();
      return okText(res, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

// ─── Actions discovery ──────────────────────────────────────────────────────

tool(
  "list_action_groups",
  "Compact group summary (name, total, enabled, disabled). Always start here before listing individual actions.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      return okText({ count: actions.length, groups: summarizeGroups(actions) }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "list_actions_in_group",
  "All actions in one group. Use after list_action_groups to drill into a specific group.",
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
      return okText({ group, count: actions.length, actions: compactActions(actions) }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "find_actions",
  "Search actions by keyword. Returns id, name, group, enabled. Call before do_action to confirm action exists.",
  {
    query: z.string(),
    group: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  async ({ query, group, limit }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = compactActions(
        findActions(parseActionsList(res as Record<string, unknown>), query, group).slice(0, limit)
      );
      return okText({ count: actions.length, actions }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "check_action_exists",
  "Quickly check if an action name exists. Returns {found, id?}. Use before do_action in automations.",
  {
    name: z.string().describe("Exact or case-insensitive action name"),
  },
  async ({ name }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      const found = findActionExact(actions, name);
      return okText(found ? { found: true, id: found.id, name: found.name } : { found: false }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_action_detail",
  "Live metadata for one action. from_disk=true reads actions.json — only safe when Streamer.bot is stopped.",
  {
    action_id_or_name: z.string(),
    from_disk: z
      .boolean()
      .default(false)
      .describe("WARNING: disk data is stale if Streamer.bot is running. Only use when SB is fully stopped."),
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
      if (!live) {
        return errText({
          error: `Action not found: ${action_id_or_name}`,
          fix: "Run find_actions with a keyword to locate it",
          code: "ACTION_NOT_FOUND",
        });
      }

      const out: Record<string, unknown> = { live: compactAction(live) };
      const dataPath = cfg().dataPath;
      if (from_disk && dataPath) {
        out.disk = getActionDetail(dataPath, action_id_or_name);
      }
      return okText(out, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_actions",
  "Full action list. LARGE — prefer list_action_groups or find_actions unless you need all IDs at once.",
  {
    verbose: z.boolean().default(false).describe("If true, returns full API response with subaction counts"),
  },
  async ({ verbose }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      if (!verbose) {
        const actions = compactActions(parseActionsList(res as Record<string, unknown>));
        return okText({ count: actions.length, actions }, cfg());
      }
      return okText(res, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "do_action",
  "Run an action by id or name. For result verification with event watching, use test_action instead.",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ action_id, action_name, args }) => {
    if (!action_id && !action_name) {
      return errText({
        error: "Provide action_id or action_name",
        fix: "Run find_actions or check_action_exists first",
        code: "ACTION_NOT_FOUND",
      });
    }
    try {
      await ensureConnected(client);
      const id = action_id ?? action_name!;
      await client.doAction(id, args as Record<string, unknown>, !!action_id);
      return okText({ executed: true }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "do_action_http",
  "Fire-and-forget action via HTTP (port 7474). Faster than WS; no response. Requires HTTP server enabled.",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ action_id, action_name, args }) => {
    if (!action_id && !action_name) {
      return errText({
        error: "Provide action_id or action_name",
        fix: "Run find_actions first",
        code: "ACTION_NOT_FOUND",
      });
    }
    try {
      const http = await checkHttpServer(cfg().host, cfg().httpPort);
      if (!http.available) {
        return errText({
          error: "HTTP server not reachable",
          fix: "Enable HTTP Server in Streamer.bot Servers/Clients, then validate_setup",
          code: "HTTP_UNAVAILABLE",
        });
      }
      const id = action_id ?? action_name!;
      await client.doActionHttp(id, args as Record<string, unknown>, !!action_id);
      return okText({ sent: true }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "test_action",
  "Run action and watch for resulting events. Use instead of do_action when you need to verify the automation worked.",
  {
    action_id: z.string().optional(),
    action_name: z.string().optional(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    watch_events_seconds: z.number().int().min(0).max(30).default(3),
  },
  async ({ action_id, action_name, args, watch_events_seconds }) => {
    if (!action_id && !action_name) {
      return errText({
        error: "Provide action_id or action_name",
        fix: "Run find_actions first",
        code: "ACTION_NOT_FOUND",
      });
    }
    try {
      await ensureConnected(client);
      const id = action_id ?? action_name!;
      await client.doAction(id, args as Record<string, unknown>, !!action_id);
      if (watch_events_seconds > 0) {
        await new Promise((r) => setTimeout(r, watch_events_seconds * 1000));
      }
      const after = client.getBufferedEvents(20);
      return okText(
        {
          events: summarizeEvents(after),
          currentScene: client.getLastScene()?.name ?? null,
        },
        cfg()
      );
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "trigger_primitive",
  "Run a configured primitive action (overlay_show, overlay_hide, etc.). View available primitives in validate_setup output.",
  {
    primitive: z.string().describe("Key from primitives config, e.g. overlay_show, overlay_hide"),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ primitive, args }) => {
    const name = cfg().primitives[primitive];
    if (!name) {
      return errText({
        error: `Unknown primitive '${primitive}'`,
        fix: "Check validate_setup primitives or set STREAMERBOT_PRIMITIVES",
        code: "ACTION_NOT_FOUND",
      });
    }
    try {
      await ensureConnected(client);
      await client.doAction(name, args as Record<string, unknown>, false);
      return okText({ primitive, action: name, executed: true }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

// ─── Automation planning ────────────────────────────────────────────────────

tool(
  "describe_automation",
  "Describe a streaming goal in plain English → get pattern, matching actions, and step-by-step plan.",
  {
    goal: z.string().describe("e.g. 'show SE overlay only in ingame scene'"),
  },
  async ({ goal }) => {
    try {
      await ensureConnected(client);
      const res = await client.getActions();
      const actions = parseActionsList(res as Record<string, unknown>);
      return okText(describeAutomationGoal(goal, actions), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

// ─── Globals via bridge ─────────────────────────────────────────────────────

tool(
  "set_global_via_action",
  "Set a global variable via bridge action. Bridge action must exist first — see get_bridge_setup_guide.",
  {
    name: z.string().describe("Global variable name"),
    value: z.union([z.string(), z.number(), z.boolean()]),
    persisted: z.boolean().default(true),
  },
  async ({ name, value, persisted }) => {
    try {
      await ensureConnected(client);
      const config = cfg();
      const actionName = config.bridgeActions.setGlobal;
      const actionsRes = await client.getActions();
      const actions = parseActionsList(actionsRes as Record<string, unknown>);
      if (!actions.some((a) => a.name === actionName)) {
        return errText({
          error: `Bridge action "${actionName}" not found`,
          fix: "Call get_bridge_setup_guide and create the action in Streamer.bot UI first.",
          code: "BRIDGE_NOT_FOUND",
        });
      }
      await client.doAction(
        actionName,
        { name, value: String(value), persisted: String(persisted) },
        false
      );
      return okText({ variable: name, set: true }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_globals",
  "All global variables (secrets redacted). Returns persisted or session globals.",
  {
    persisted: z.boolean().default(true),
  },
  async ({ persisted }) => {
    try {
      await ensureConnected(client);
      const res = (await client.getGlobals(persisted)) as Record<string, unknown>;
      return okText(formatGlobals(res), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_global",
  "One global variable by name (secret-safe). Returns null with hint if variable doesn't exist.",
  {
    variable: z.string(),
    persisted: z.boolean().default(true),
  },
  async ({ variable, persisted }) => {
    try {
      await ensureConnected(client);
      const res = (await client.getGlobal(variable, persisted)) as Record<string, unknown>;
      const val = res.value ?? res.global ?? res;
      if (val === null || val === undefined || (res.status === "error" && !val)) {
        return okText(
          {
            value: null,
            hint: "Variable not set. Use set_global_via_action to create it.",
          },
          cfg()
        );
      }
      return okText({ name: variable, value: val }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

// ─── Events ─────────────────────────────────────────────────────────────────

tool(
  "get_events",
  "All subscribable event categories and types (large). Prefer list_event_categories for compact list.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getEvents(), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "list_event_categories",
  "All subscribable event categories from Streamer.bot. Use to build custom subscribe_to_events calls.",
  {
    verbose: z.boolean().default(false).describe("If true, include nested event types per category"),
  },
  async ({ verbose }) => {
    try {
      await ensureConnected(client);
      const res = await client.getEvents();
      const events = (res.events as Record<string, string[]>) ?? {};
      if (verbose) {
        return okText({ categories: events, total: Object.keys(events).length }, cfg());
      }
      const categories = Object.keys(events);
      return okText({ categories, total: categories.length }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "subscribe_preset",
  "Subscribe to a named event bundle: streaming|alerts|obs|chat|all. Call before get_recent_events.",
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
      await client.subscribeToEvents(events);
      return okText({ preset, categories: Object.keys(events) }, cfg());
    } catch (e) {
      return catchErr(e);
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
      await client.subscribeToEvents(events);
      return okText({ categories: Object.keys(events) }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "subscribe_to_all_events",
  "Subscribe to every event category. Adds load to buffer — use subscribe_preset for specific workflows.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      await client.subscribeToAll();
      const count = Object.keys(client.getSubscribedEvents()).length;
      const warning =
        count > 15
          ? "High event volume subscribed. Consider subscribe_preset for targeted monitoring."
          : null;
      return okText({ categories_subscribed: count, warning }, cfg());
    } catch (e) {
      return catchErr(e);
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
      await client.unsubscribeFromEvents(events);
      return okText({ unsubscribed: Object.keys(events) }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "get_recent_events",
  "Events from buffer. Call subscribe_preset first if empty. Filter by source or type to reduce output.",
  {
    limit: z.number().int().min(1).max(500).default(50),
    source: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ limit, source, type }) => {
    const events = client.getBufferedEvents(limit, source, type);
    if (!events.length) {
      return okText(
        {
          events: [],
          hint: "No events — run subscribe_preset or subscribe_to_all_events first.",
        },
        cfg()
      );
    }
    return okText({ count: events.length, events }, cfg());
  }
);

tool(
  "summarize_recent_events",
  "Compact event count by source/type. Prefer this over get_recent_events for planning; use get_recent_events for debugging.",
  {
    limit: z.number().int().min(1).max(500).default(100),
    source: z.string().optional(),
    type: z.string().optional(),
  },
  async ({ limit, source, type }) => {
    const events = client.getBufferedEvents(limit, source, type);
    return okText(summarizeEvents(events), cfg());
  }
);

tool(
  "wait_for_event",
  "Wait up to timeout_ms for an event matching source/type. Subscribe to events first.",
  {
    source: z.string().optional().describe("e.g. Obs, Twitch"),
    type: z.string().optional().describe("e.g. SceneChanged, ChatMessage"),
    timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  },
  async ({ source, type, timeout_ms }) => {
    await ensureConnected(client).catch(() => {});
    const ev = await client.waitForEvent({ source, type, timeoutMs: timeout_ms });
    if (!ev) {
      return okText(
        {
          event: null,
          hint: "No matching event — ensure subscribe_preset ran and trigger the event in Streamer.bot/OBS",
        },
        cfg()
      );
    }
    return okText({ source: ev.source, type: ev.type, timestamp: ev.timestamp }, cfg());
  }
);

tool(
  "get_current_scene",
  "Last OBS scene from buffer. Subscribe obs preset and change scene in OBS if null.",
  {},
  async () => {
    const scene = client.getLastScene();
    if (!scene?.name) {
      return okText(
        {
          scene: null,
          hint: "Subscribe subscribe_preset obs, change OBS scene, or wait_for_event source=Obs type=SceneChanged",
        },
        cfg()
      );
    }
    return okText({ scene: scene.name, timestamp: scene.timestamp }, cfg());
  }
);

tool(
  "clear_event_buffer",
  "Clear all buffered events. Use before a test sequence to get a clean baseline.",
  {},
  async () => {
    client.clearEventBuffer();
    return okText({ cleared: true }, cfg());
  }
);

tool(
  "get_subscribed_events",
  "Currently subscribed event categories.",
  {},
  async () => okText(client.getSubscribedEvents(), cfg())
);

// ─── Code triggers & C# ─────────────────────────────────────────────────────

tool(
  "get_code_triggers",
  "Custom code triggers registered in Streamer.bot. Returns name and id for use in execute_code_trigger.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      return okText(await client.getCodeTriggers(), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "execute_code_trigger",
  "Fire a custom code trigger by name. Call get_code_triggers first to confirm it exists.",
  {
    trigger_name: z.string(),
    args: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  async ({ trigger_name, args }) => {
    try {
      await ensureConnected(client);
      await client.executeCodeTrigger(trigger_name, args as Record<string, unknown>);
      return okText({ triggered: trigger_name }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "list_csharp_templates",
  "Available C# templates. Call this before generate_csharp_script to get valid template names.",
  {},
  async () => okText({ templates: listTemplates().map((t) => t.id) }, cfg())
);

tool(
  "generate_csharp_script",
  "Generate C# sub-action script for Streamer.bot. Call list_csharp_templates first for valid template names.",
  {
    template: z.string(),
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
    if (!TEMPLATE_IDS.includes(params.template as (typeof TEMPLATE_IDS)[number])) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Unknown template",
              fix: "Call list_csharp_templates to see valid options",
              code: "TEMPLATE_NOT_FOUND",
              available: [...TEMPLATE_IDS],
            }),
          },
        ],
        isError: true,
      };
    }
    try {
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
      return okText(out, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "inspect_actions_from_disk",
  "Read-only actions.json index. ONLY safe when Streamer.bot is fully stopped. Live data: use get_actions instead.",
  {
    group: z.string().optional(),
    limit: z.number().int().default(50),
    force: z
      .boolean()
      .default(false)
      .describe("Set true to read disk while Streamer.bot is connected (data may be stale)"),
  },
  async ({ group, limit, force }) => {
    const dataPath = cfg().dataPath;
    if (!dataPath) {
      return errText({
        error: "STREAMERBOT_DATA_PATH not set",
        fix: "Set env var to Streamer.bot/data folder for disk index",
        code: "UNKNOWN",
      });
    }
    if (client.isConnected && !force) {
      return okText(
        {
          data: null,
          warning:
            "Streamer.bot appears to be running. Disk data may be stale. Proceed with force=true only if you have stopped SB.",
        },
        cfg()
      );
    }
    const { actions, warning } = loadActionsIndex(dataPath);
    let list = actions;
    if (group) list = list.filter((a) => a.group.toLowerCase() === group.toLowerCase());
    return okText({ warning, count: list.length, actions: list.slice(0, limit) }, cfg());
  }
);

// ─── Commands, credits, chat ──────────────────────────────────────────────────

tool(
  "get_commands",
  "Chat commands defined in Streamer.bot. Returns command word, action linked, and enabled status.",
  {},
  async () => {
    try {
      await ensureConnected(client);
      const raw = (await client.getCommands()) as Record<string, unknown>;
      return okText(formatCommands(raw), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.getCredits(), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.testCredits(), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "clear_credits",
  "Wipe all end-of-stream credits. IRREVERSIBLE — requires confirm=true.",
  {
    confirm: z.boolean().default(false),
  },
  async ({ confirm }) => {
    const block = requireConfirm(confirm, "clear_credits");
    if (block) return errText(block);
    try {
      await ensureConnected(client);
      await client.clearCredits();
      return okText({ cleared: true }, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "send_message",
  "Send chat message to Twitch/Kick/YouTube. REQUIRES confirm=true — message goes live to public chat.",
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
      await client.sendMessage(message, platform, bot, internal);
      return okText({ sent: true, platform }, cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.twitchGetUserGlobals(variable, persisted), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.twitchGetUserGlobal(user_id, persisted, variable), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.twitchGetEmotes(), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.youtubeGetEmotes(), cfg());
    } catch (e) {
      return catchErr(e);
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
      return okText(await client.getUserPronouns(user_login, platform), cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

tool(
  "raw_request",
  "Send arbitrary WS request (advanced). Use only when no specific tool covers your need. See Streamer.bot WS API docs.",
  {
    request: z.string(),
    params: z.record(z.unknown()).optional(),
  },
  async ({ request: req, params }) => {
    try {
      await ensureConnected(client);
      const res = await client.sendRequest({ request: req, ...(params ?? {}) } as never);
      return okText(res, cfg());
    } catch (e) {
      return catchErr(e);
    }
  }
);

// ─── MCP Prompts ─────────────────────────────────────────────────────────────

server.prompt(
  "scene_overlay_router",
  "Set up an overlay (source) to show only in a specific OBS scene.",
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Workflow: scene overlay router",
            "1. validate_setup",
            "2. describe_automation with the user's scene/overlay goal",
            "3. get_ui_walkthrough add_obs_source_visibility",
            "4. get_ui_walkthrough add_obs_scene_trigger",
            "5. trigger_primitive overlay_show or overlay_hide to test",
            "6. test_action + subscribe_preset obs + get_current_scene to verify",
          ].join("\n"),
        },
      },
    ],
  })
);

server.prompt(
  "alert_chain_setup",
  "Configure alert actions for follows/subs/cheers.",
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Workflow: alert chain",
            "1. validate_setup",
            "2. describe_automation with alert types needed",
            "3. subscribe_preset alerts",
            "4. wait_for_event or test_action to verify",
          ].join("\n"),
        },
      },
    ],
  })
);

server.prompt(
  "chat_command_setup",
  "Add a chat command that triggers a Streamer.bot action.",
  async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: [
            "Workflow: chat command",
            "1. get_commands to see existing commands",
            "2. describe_automation with command goal",
            "3. get_ui_walkthrough create_action if new action needed",
            "4. test_action on the linked action",
          ].join("\n"),
        },
      },
    ],
  })
);

// ─── Resources ───────────────────────────────────────────────────────────────

server.resource("streamerbot-agent-guide", "streamerbot://agent-guide", {
  description: "Structured agent operating guide (section-addressable via get_agent_guide)",
  mimeType: "application/json",
}, async () => ({
  contents: [
    {
      uri: "streamerbot://agent-guide",
      mimeType: "application/json",
      text: JSON.stringify(AGENT_INSTRUCTIONS),
    },
  ],
}));

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
          text: JSON.stringify(
            {
              count: actions.length,
              groups: summarizeGroups(actions),
              last_updated: new Date().toISOString(),
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (e) {
    const c = catchErr(e);
    return {
      contents: [
        {
          uri: "streamerbot://actions-summary",
          mimeType: "application/json",
          text: c.content[0].text,
        },
      ],
    };
  }
});

server.resource("streamerbot-connection", "streamerbot://connection", {
  description: "Connection status with HTTP availability",
  mimeType: "application/json",
}, async () => {
  const c = cfg();
  const http = await checkHttpServer(c.host, c.httpPort);
  return {
    contents: [
      {
        uri: "streamerbot://connection",
        mimeType: "application/json",
        text: JSON.stringify(
          {
            ...client.getConnectionInfo(),
            http_available: http.available,
            subscribed_categories: Object.keys(client.getSubscribedEvents()),
          },
          null,
          2
        ),
      },
    ],
  };
});

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

server.resource("streamerbot-http-status", "streamerbot://http-status", {
  description: "HTTP server availability and latency",
  mimeType: "application/json",
}, async () => {
  const c = cfg();
  const status = await checkHttpServer(c.host, c.httpPort);
  return {
    contents: [
      {
        uri: "streamerbot://http-status",
        mimeType: "application/json",
        text: JSON.stringify(status, null, 2),
      },
    ],
  };
});

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
