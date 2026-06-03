/**
 * Central configuration from environment variables.
 * End users configure once in mcp.json; agents read via get_connection_status / validate_setup.
 */

export interface AppConfig {
  host: string;
  wsPort: number;
  httpPort: number;
  endpoint: string;
  password?: string;
  eventBufferSize: number;
  dataPath?: string;
  /** Bridge action names — user creates these once in Streamer.bot UI (or via import). */
  bridgeActions: {
    setGlobal: string;
    setUserGlobal: string;
  };
  primitives: Record<string, string>;
  secretPatterns: RegExp[];
}

const DEFAULT_PRIMITIVES: Record<string, string> = {
  overlay_show: "SE Overlay Show",
  overlay_hide: "SE Overlay Hide",
};

function parsePrimitives(): Record<string, string> {
  const raw = process.env.STREAMERBOT_PRIMITIVES;
  if (!raw) return { ...DEFAULT_PRIMITIVES };
  try {
    return { ...DEFAULT_PRIMITIVES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PRIMITIVES };
  }
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    host: overrides?.host ?? process.env.STREAMERBOT_HOST ?? "127.0.0.1",
    wsPort: overrides?.wsPort ?? parseInt(process.env.STREAMERBOT_PORT ?? "8080", 10),
    httpPort: overrides?.httpPort ?? parseInt(process.env.STREAMERBOT_HTTP_PORT ?? "7474", 10),
    endpoint: overrides?.endpoint ?? process.env.STREAMERBOT_ENDPOINT ?? "/",
    password: overrides?.password ?? process.env.STREAMERBOT_PASSWORD,
    eventBufferSize:
      overrides?.eventBufferSize ??
      parseInt(process.env.STREAMERBOT_EVENT_BUFFER ?? "200", 10),
    dataPath: overrides?.dataPath ?? process.env.STREAMERBOT_DATA_PATH,
    bridgeActions: {
      setGlobal:
        overrides?.bridgeActions?.setGlobal ??
        process.env.STREAMERBOT_BRIDGE_SET_GLOBAL ??
        "MCP Set Global",
      setUserGlobal:
        overrides?.bridgeActions?.setUserGlobal ??
        process.env.STREAMERBOT_BRIDGE_SET_USER_GLOBAL ??
        "MCP Set User Global",
    },
    primitives: overrides?.primitives ?? parsePrimitives(),
    secretPatterns: [
      /api[_-]?key/i,
      /password/i,
      /secret/i,
      /token/i,
      /^sk-/i,
    ],
  };
}

export const EVENT_PRESETS: Record<string, Record<string, string[]>> = {
  streaming: {
    Twitch: ["StreamOnline", "StreamOffline", "ChatMessage", "Follow", "Sub", "Raid"],
    Obs: ["SceneChanged", "StreamingStarted", "StreamingStopped"],
    StreamElements: ["Tip", "Merch"],
  },
  alerts: {
    Twitch: ["Follow", "Sub", "Cheer", "GiftSub", "Raid", "RewardRedemption"],
    StreamElements: ["Tip"],
    Streamlabs: ["Donation"],
  },
  obs: {
    Obs: ["*"],
  },
  chat: {
    Twitch: ["ChatMessage", "FirstWord"],
    Command: ["Triggered"],
  },
  all: {}, // filled dynamically from GetEvents
};
