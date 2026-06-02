#!/usr/bin/env node
/**
 * Streamer.bot MCP Server
 *
 * Exposes every capability of the Streamer.bot WebSocket API as MCP tools and resources,
 * allowing any AI agent to fully control a running Streamer.bot instance.
 *
 * Environment variables:
 *   STREAMERBOT_HOST          - Host where Streamer.bot is running (default: 127.0.0.1)
 *   STREAMERBOT_PORT          - WebSocket server port (default: 8080)
 *   STREAMERBOT_ENDPOINT      - WebSocket endpoint path (default: /)
 *   STREAMERBOT_PASSWORD      - Optional password if auth is enabled
 *   STREAMERBOT_EVENT_BUFFER  - Number of events to keep in memory (default: 200)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StreamerbotClient } from "./client";

// ─── Server setup ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "streamerbot-mcp",
  version: "1.0.0",
  description: "Full control of Streamer.bot via its WebSocket API",
});

const client = new StreamerbotClient({
  eventBufferSize: parseInt(process.env.STREAMERBOT_EVENT_BUFFER ?? "200"),
});

// ─── Helper: ensure connection ───────────────────────────────────────────────

async function ensureConnected(): Promise<void> {
  if (!client.isConnected) {
    await client.connect();
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── TOOL GROUP 1: Connection & Instance Info ────────────────────────────────

server.tool(
  "get_connection_status",
  "Get the current connection status and configuration of this MCP ↔ Streamer.bot link.",
  {},
  async () => {
    const info = client.getConnectionInfo();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "connect",
  "Connect (or reconnect) to the Streamer.bot WebSocket server.",
  {
    host: z.string().optional().describe("Override the host (default from env STREAMERBOT_HOST or 127.0.0.1)"),
    port: z.number().int().optional().describe("Override the port (default from env STREAMERBOT_PORT or 8080)"),
    password: z.string().optional().describe("Optional password if the WebSocket server requires authentication"),
  },
  async ({ host, port, password }) => {
    try {
      if (host || port || password) {
        // Disconnect existing and update config
        client.disconnect();
        // Rebuild client with new config
        Object.assign(client, new StreamerbotClient({ host, port, password }));
      }
      await ensureConnected();
      return {
        content: [{ type: "text", text: `Connected to Streamer.bot at ${client.getConnectionInfo().host}:${client.getConnectionInfo().port}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Connection failed: ${formatError(err)}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "disconnect",
  "Disconnect from the Streamer.bot WebSocket server.",
  {},
  async () => {
    client.disconnect();
    return {
      content: [{ type: "text", text: "Disconnected from Streamer.bot." }],
    };
  }
);

server.tool(
  "get_info",
  "Fetch information about the connected Streamer.bot instance (version, operating system, etc.).",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getInfo();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "get_broadcaster",
  "Fetch information about the connected broadcaster account(s) across all platforms.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getBroadcaster();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "get_active_viewers",
  "Fetch a list of all active viewers currently watching any connected broadcaster's stream.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getActiveViewers();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 2: Actions ────────────────────────────────────────────────────

server.tool(
  "get_actions",
  "Fetch a complete list of all actions defined in the Streamer.bot instance, including their IDs, names, groups, and enabled state.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getActions();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "do_action",
  "Execute any action on the Streamer.bot instance by its ID or name, with optional arguments. This is the primary way to trigger configured actions.",
  {
    action_id: z.string().optional().describe("The GUID of the action to execute (preferred over name for reliability)"),
    action_name: z.string().optional().describe("The name of the action to execute (used when ID is unknown)"),
    args: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Key-value arguments to pass into the action (available as %argName% variables inside it)"),
  },
  async ({ action_id, action_name, args }) => {
    if (!action_id && !action_name) {
      return {
        content: [{ type: "text", text: "Provide either action_id or action_name." }],
        isError: true,
      };
    }
    try {
      await ensureConnected();
      const identifier = action_id ?? action_name!;
      const byId = !!action_id;
      const res = await client.doAction(identifier, args as Record<string, unknown> | undefined, byId);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 3: Events & Subscriptions ────────────────────────────────────

server.tool(
  "get_events",
  "Fetch a full list of every event category and event type that can be subscribed to on this Streamer.bot instance.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getEvents();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "subscribe_to_events",
  "Subscribe to one or more event categories/types so they are captured in the event buffer. Events are organized by category (e.g. 'Twitch') and type (e.g. 'Follow'). Use '*' as the type to subscribe to all events in a category.",
  {
    events: z
      .record(z.array(z.string()))
      .describe(
        'Map of category → [event types]. Example: {"Twitch": ["Follow", "Sub"], "OBS": ["*"]}. Use "*" to subscribe to all events in a category.'
      ),
  },
  async ({ events }) => {
    try {
      await ensureConnected();
      const res = await client.subscribeToEvents(events);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "subscribe_to_all_events",
  "Subscribe to ALL available event categories and types in a single call. After this, every event Streamer.bot emits will be captured in the event buffer.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.subscribeToAll();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "unsubscribe_from_events",
  "Unsubscribe from one or more event categories/types to stop capturing them in the event buffer.",
  {
    events: z
      .record(z.array(z.string()))
      .describe('Map of category → [event types] to unsubscribe from. Example: {"Twitch": ["Follow"]}'),
  },
  async ({ events }) => {
    try {
      await ensureConnected();
      const res = await client.unsubscribeFromEvents(events);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "get_recent_events",
  "Retrieve events from the in-memory event buffer (events Streamer.bot has emitted since subscription began). Use subscribe_to_events or subscribe_to_all_events first.",
  {
    limit: z.number().int().min(1).max(500).default(50).describe("Maximum number of recent events to return (newest last)"),
    source: z.string().optional().describe("Filter by event source/category (e.g. 'Twitch', 'OBS', 'YouTube')"),
    type: z.string().optional().describe("Filter by event type (partial match, case-insensitive, e.g. 'Follow', 'Chat')"),
  },
  async ({ limit, source, type }) => {
    const events = client.getBufferedEvents(limit, source, type);
    return {
      content: [
        {
          type: "text",
          text: events.length > 0
            ? JSON.stringify(events, null, 2)
            : "No events in buffer. Use subscribe_to_events or subscribe_to_all_events first.",
        },
      ],
    };
  }
);

server.tool(
  "clear_event_buffer",
  "Clear all events from the in-memory event buffer.",
  {},
  async () => {
    client.clearEventBuffer();
    return { content: [{ type: "text", text: "Event buffer cleared." }] };
  }
);

server.tool(
  "get_subscribed_events",
  "List all event categories and types currently subscribed to.",
  {},
  async () => {
    const subs = client.getSubscribedEvents();
    return {
      content: [
        {
          type: "text",
          text: Object.keys(subs).length > 0
            ? JSON.stringify(subs, null, 2)
            : "Not subscribed to any events yet.",
        },
      ],
    };
  }
);

// ─── TOOL GROUP 4: Code Triggers ──────────────────────────────────────────────

server.tool(
  "get_code_triggers",
  "Get a list of all custom code triggers registered in Streamer.bot (created via C# RegisterCustomTrigger).",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCodeTriggers();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "execute_code_trigger",
  "Fire a custom code trigger by name, causing any actions associated with it to run.",
  {
    trigger_name: z.string().describe("The exact name of the code trigger to execute"),
    args: z
      .record(z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("Key-value arguments to pass to the trigger"),
  },
  async ({ trigger_name, args }) => {
    try {
      await ensureConnected();
      const res = await client.executeCodeTrigger(trigger_name, args as Record<string, unknown> | undefined);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 5: Commands ───────────────────────────────────────────────────

server.tool(
  "get_commands",
  "Retrieve the full list of commands defined in Streamer.bot, including their trigger words, enabled/disabled state, and associated actions.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCommands();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 6: Credits ────────────────────────────────────────────────────

server.tool(
  "get_credits",
  "Fetch the current credits system data (list of users and their credits for the stream's end-of-stream credits roll).",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCredits();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "test_credits",
  "Fill the credits system with test data for development/testing purposes.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.testCredits();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "clear_credits",
  "Reset / clear all current credits system data.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.clearCredits();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 7: Chat & Messaging ──────────────────────────────────────────

server.tool(
  "send_message",
  "Send a chat message to a streaming platform (Twitch, Kick, or YouTube) directly from Streamer.bot.",
  {
    message: z.string().min(1).describe("The message text to send"),
    platform: z
      .enum(["twitch", "kick", "youtube"])
      .describe("The platform to send the message on"),
    bot: z
      .boolean()
      .default(false)
      .describe("If true, send as the bot account; if false, send as the broadcaster account"),
    internal: z
      .boolean()
      .default(false)
      .describe("If true, treat as an internal message (won't be displayed in Streamer.bot's chat window)"),
  },
  async ({ message, platform, bot, internal: isInternal }) => {
    try {
      await ensureConnected();
      const res = await client.sendMessage(message, platform, bot, isInternal);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 8: Global Variables ──────────────────────────────────────────

server.tool(
  "get_globals",
  "Retrieve all Streamer.bot global variables (either persisted/permanent or temporary session variables).",
  {
    persisted: z
      .boolean()
      .default(true)
      .describe("If true, get persisted (permanent) globals; if false, get temporary (session) globals"),
  },
  async ({ persisted }) => {
    try {
      await ensureConnected();
      const res = await client.getGlobals(persisted);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "get_global",
  "Get the value of a single named Streamer.bot global variable.",
  {
    variable: z.string().describe("The name of the global variable to retrieve"),
    persisted: z
      .boolean()
      .default(true)
      .describe("If true, look in persisted globals; if false, look in temporary globals"),
  },
  async ({ variable, persisted }) => {
    try {
      await ensureConnected();
      const res = await client.getGlobal(variable, persisted);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "twitch_get_user_globals",
  "Fetch the value of a specific user variable across ALL Twitch users (i.e., see how every user's value for that variable).",
  {
    variable: z.string().describe("The name of the user variable to retrieve across all users"),
    persisted: z
      .boolean()
      .default(true)
      .describe("If true, get persisted user globals; if false, get temporary ones"),
  },
  async ({ variable, persisted }) => {
    try {
      await ensureConnected();
      const res = await client.twitchGetUserGlobals(variable, persisted);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "twitch_get_user_global",
  "Get either a single user variable or all variables for a specific Twitch user.",
  {
    user_id: z.string().describe("The Twitch user ID to query (numeric string, e.g. '136079477')"),
    persisted: z
      .boolean()
      .default(true)
      .describe("If true, get persisted user globals; if false, get temporary ones"),
    variable: z
      .string()
      .optional()
      .describe("Specific variable name to retrieve; omit to get ALL variables for this user"),
  },
  async ({ user_id, persisted, variable }) => {
    try {
      await ensureConnected();
      const res = await client.twitchGetUserGlobal(user_id, persisted, variable);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 9: Emotes ─────────────────────────────────────────────────────

server.tool(
  "twitch_get_emotes",
  "Fetch the list of available Twitch emotes (channel emotes, global emotes, BetterTTV, 7TV, etc.) from Streamer.bot.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.twitchGetEmotes();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

server.tool(
  "youtube_get_emotes",
  "Fetch the list of available YouTube emotes from Streamer.bot.",
  {},
  async () => {
    try {
      await ensureConnected();
      const res = await client.youtubeGetEmotes();
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 10: User Utilities ────────────────────────────────────────────

server.tool(
  "get_user_pronouns",
  "Fetch the configured pronouns for a specific user on a given platform.",
  {
    user_login: z.string().describe("The login/username of the user"),
    platform: z
      .string()
      .default("twitch")
      .describe("The platform to look up pronouns on (currently 'twitch' is supported)"),
  },
  async ({ user_login, platform }) => {
    try {
      await ensureConnected();
      const res = await client.getUserPronouns(user_login, platform);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── TOOL GROUP 11: Raw WebSocket Request ─────────────────────────────────────

server.tool(
  "raw_request",
  "Send an arbitrary raw JSON request to the Streamer.bot WebSocket server. Use this for any request not covered by specific tools, or for future API additions. The 'id' field is automatically added.",
  {
    request: z.string().describe("The request type name (e.g. 'GetInfo', 'DoAction', 'Subscribe')"),
    params: z
      .record(z.unknown())
      .optional()
      .describe("Additional parameters to include in the request body as key-value pairs"),
  },
  async ({ request: requestType, params }) => {
    try {
      await ensureConnected();
      const payload = { request: requestType, ...(params ?? {}) };
      const res = await client.sendRequest(payload as any);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatError(err) }], isError: true };
    }
  }
);

// ─── RESOURCES ───────────────────────────────────────────────────────────────

server.resource(
  "streamerbot-info",
  "streamerbot://info",
  {
    description: "Live Streamer.bot instance information (version, name, OS, uptime)",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getInfo();
      return {
        contents: [
          {
            uri: "streamerbot://info",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://info",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-broadcaster",
  "streamerbot://broadcaster",
  {
    description: "Connected broadcaster account info across all platforms (Twitch, YouTube, Kick)",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getBroadcaster();
      return {
        contents: [
          {
            uri: "streamerbot://broadcaster",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://broadcaster",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-actions",
  "streamerbot://actions",
  {
    description: "Full list of all actions configured in Streamer.bot with their IDs, names, groups, and state",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getActions();
      return {
        contents: [
          {
            uri: "streamerbot://actions",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://actions",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-commands",
  "streamerbot://commands",
  {
    description: "All chat commands defined in Streamer.bot",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCommands();
      return {
        contents: [
          {
            uri: "streamerbot://commands",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://commands",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-active-viewers",
  "streamerbot://active-viewers",
  {
    description: "Current active viewers across all connected streaming platforms",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getActiveViewers();
      return {
        contents: [
          {
            uri: "streamerbot://active-viewers",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://active-viewers",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-globals-persisted",
  "streamerbot://globals/persisted",
  {
    description: "All persisted (permanent) global variables in Streamer.bot",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getGlobals(true);
      return {
        contents: [
          {
            uri: "streamerbot://globals/persisted",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://globals/persisted",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-globals-temporary",
  "streamerbot://globals/temporary",
  {
    description: "All temporary (session) global variables in Streamer.bot",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getGlobals(false);
      return {
        contents: [
          {
            uri: "streamerbot://globals/temporary",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://globals/temporary",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-credits",
  "streamerbot://credits",
  {
    description: "Current credits system data for the live stream",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCredits();
      return {
        contents: [
          {
            uri: "streamerbot://credits",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://credits",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-events",
  "streamerbot://events",
  {
    description: "All events available for subscription on this Streamer.bot instance",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getEvents();
      return {
        contents: [
          {
            uri: "streamerbot://events",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://events",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-event-buffer",
  "streamerbot://event-buffer",
  {
    description: "The last 200 events received from Streamer.bot since subscription began",
    mimeType: "application/json",
  },
  async () => {
    const events = client.getBufferedEvents(200);
    return {
      contents: [
        {
          uri: "streamerbot://event-buffer",
          mimeType: "application/json",
          text: JSON.stringify(events, null, 2),
        },
      ],
    };
  }
);

server.resource(
  "streamerbot-code-triggers",
  "streamerbot://code-triggers",
  {
    description: "All custom code triggers registered in Streamer.bot",
    mimeType: "application/json",
  },
  async () => {
    try {
      await ensureConnected();
      const res = await client.getCodeTriggers();
      return {
        contents: [
          {
            uri: "streamerbot://code-triggers",
            mimeType: "application/json",
            text: JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        contents: [
          {
            uri: "streamerbot://code-triggers",
            mimeType: "text/plain",
            text: `Error: ${formatError(err)}`,
          },
        ],
      };
    }
  }
);

server.resource(
  "streamerbot-connection",
  "streamerbot://connection",
  {
    description: "Current MCP ↔ Streamer.bot connection status and configuration",
    mimeType: "application/json",
  },
  async () => {
    const info = client.getConnectionInfo();
    return {
      contents: [
        {
          uri: "streamerbot://connection",
          mimeType: "application/json",
          text: JSON.stringify(info, null, 2),
        },
      ],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  // Attempt initial connection (non-fatal — tools will retry)
  try {
    await client.connect();
    // Subscribe to all events by default so the buffer starts filling immediately
    await client.subscribeToAll();
  } catch {
    // Streamer.bot may not be running yet — that's fine; each tool call will retry
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
