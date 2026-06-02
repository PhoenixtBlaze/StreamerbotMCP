import WebSocket from "ws";
import { EventEmitter } from "events";
import * as crypto from "crypto";

export interface StreamerbotConfig {
  host: string;
  port: number;
  endpoint: string;
  password?: string;
  autoReconnect: boolean;
  reconnectInterval: number;
  eventBufferSize: number;
}

export interface StreamerbotRequest {
  request: string;
  id: string;
  [key: string]: unknown;
}

export interface StreamerbotResponse {
  id: string;
  status: "ok" | "error";
  [key: string]: unknown;
}

export interface StreamerbotEvent {
  timestamp: string;
  event: {
    source: string;
    type: string;
  };
  data: Record<string, unknown>;
}

export interface BufferedEvent {
  timestamp: string;
  source: string;
  type: string;
  data: Record<string, unknown>;
}

export interface PendingRequest {
  resolve: (value: StreamerbotResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticated";

export class StreamerbotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: StreamerbotConfig;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private connectionState: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private eventBuffer: BufferedEvent[] = [];
  private subscribedEvents: Map<string, string[]> = new Map();

  constructor(config?: Partial<StreamerbotConfig>) {
    super();
    this.config = {
      host: config?.host ?? process.env.STREAMERBOT_HOST ?? "127.0.0.1",
      port: config?.port ?? parseInt(process.env.STREAMERBOT_PORT ?? "8080"),
      endpoint: config?.endpoint ?? process.env.STREAMERBOT_ENDPOINT ?? "/",
      password: config?.password ?? process.env.STREAMERBOT_PASSWORD,
      autoReconnect: config?.autoReconnect ?? true,
      reconnectInterval: config?.reconnectInterval ?? 5000,
      eventBufferSize: config?.eventBufferSize ?? 200,
    };
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get isConnected(): boolean {
    return this.connectionState === "connected" || this.connectionState === "authenticated";
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      const url = `ws://${this.config.host}:${this.config.port}${this.config.endpoint}`;
      this.connectionState = "connecting";
      this.emit("connecting", url);

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this.connectionState = "disconnected";
        reject(new Error(`Failed to create WebSocket: ${err}`));
        return;
      }

      const onOpen = () => {
        this.connectionState = "connected";
        this.emit("connected");
        resolve();
      };

      const onError = (err: Error) => {
        this.connectionState = "disconnected";
        this.emit("error", err);
        reject(err);
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.once("open", onOpen);
      this.ws.once("error", onError);

      this.ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        this.connectionState = "disconnected";
        // Reject any pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket connection closed"));
          this.pendingRequests.delete(id);
        }
        this.emit("disconnected");
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Will retry via scheduleReconnect triggered by close/error handler
      });
    }, this.config.reconnectInterval);
  }

  disconnect(): void {
    this.config.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectionState = "disconnected";
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // Response to a request we sent
    if (typeof msg.id === "string" && this.pendingRequests.has(msg.id)) {
      const pending = this.pendingRequests.get(msg.id)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(msg.id);
      if (msg.status === "error") {
        pending.reject(new Error((msg.error as string) ?? "Unknown error from Streamer.bot"));
      } else {
        pending.resolve(msg as unknown as StreamerbotResponse);
      }
      return;
    }

    // Inbound event from Streamer.bot
    if (msg.event && typeof msg.event === "object") {
      const eventObj = msg.event as { source?: string; type?: string };
      const buffered: BufferedEvent = {
        timestamp: new Date().toISOString(),
        source: eventObj.source ?? "Unknown",
        type: eventObj.type ?? "Unknown",
        data: (msg.data as Record<string, unknown>) ?? {},
      };
      this.eventBuffer.push(buffered);
      // Trim buffer to configured max size
      if (this.eventBuffer.length > this.config.eventBufferSize) {
        this.eventBuffer.shift();
      }
      this.emit("event", buffered);
    }
  }

  sendRequest<T extends StreamerbotResponse>(
    request: Omit<StreamerbotRequest, "id">,
    timeoutMs = 10000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        reject(new Error("Not connected to Streamer.bot. Ensure Streamer.bot is running and the WebSocket server is enabled."));
        return;
      }

      const id = `mcp:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const payload: StreamerbotRequest = { ...request, id };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out after ${timeoutMs}ms: ${request.request}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (v: StreamerbotResponse) => void,
        reject,
        timer,
      });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to send WebSocket message: ${err}`));
      }
    });
  }

  // ─── High-level API wrappers ──────────────────────────────────────────────

  async getInfo() {
    return this.sendRequest({ request: "GetInfo" });
  }

  async getBroadcaster() {
    return this.sendRequest({ request: "GetBroadcaster" });
  }

  async getActiveViewers() {
    return this.sendRequest({ request: "GetActiveViewers" });
  }

  async getActions() {
    return this.sendRequest({ request: "GetActions" });
  }

  async doAction(actionIdOrName: string, args?: Record<string, unknown>, byId = true) {
    const action = byId
      ? { id: actionIdOrName }
      : { name: actionIdOrName };
    return this.sendRequest({
      request: "DoAction",
      action,
      args: args ?? {},
    });
  }

  async getEvents() {
    return this.sendRequest({ request: "GetEvents" });
  }

  async subscribeToEvents(events: Record<string, string[]>) {
    // Track subscriptions locally
    for (const [category, eventList] of Object.entries(events)) {
      const existing = this.subscribedEvents.get(category) ?? [];
      this.subscribedEvents.set(category, [...new Set([...existing, ...eventList])]);
    }
    return this.sendRequest({ request: "Subscribe", events });
  }

  async unsubscribeFromEvents(events: Record<string, string[]>) {
    for (const [category, eventList] of Object.entries(events)) {
      const existing = this.subscribedEvents.get(category) ?? [];
      this.subscribedEvents.set(
        category,
        existing.filter((e) => !eventList.includes(e))
      );
    }
    return this.sendRequest({ request: "UnSubscribe", events });
  }

  async subscribeToAll() {
    // Subscribe to every known event category with a wildcard "*"
    const ALL_CATEGORIES = [
      "Application", "Command", "CrowdControl", "Custom", "DonorDrive",
      "Elgato", "FileTail", "FileWatcher", "Fourthwall", "General", "Group",
      "HypeRate", "Inputs", "Kick", "KoFi", "MeldStudio", "MIDI", "Misc",
      "OBS", "Pallygg", "Patreon", "Pulsoid", "Quote", "Raw", "Shopify",
      "SpeakerBot", "SpeechToText", "StreamDeck", "StreamElements",
      "StreamLoots", "Streamerbot", "StreamerbotRemote", "Streamlabs",
      "StreamlabsDesktop", "System", "TipeeStream", "TITS", "TreatStream",
      "Twitch", "Voicemod", "VTubeStudio", "WebsocketClient",
      "WebsocketCustomServer", "YouTube",
    ];
    const allEvents: Record<string, string[]> = {};
    for (const cat of ALL_CATEGORIES) {
      allEvents[cat] = ["*"];
    }
    return this.sendRequest({ request: "Subscribe", events: allEvents });
  }

  async getCredits() {
    return this.sendRequest({ request: "GetCredits" });
  }

  async testCredits() {
    return this.sendRequest({ request: "TestCredits" });
  }

  async clearCredits() {
    return this.sendRequest({ request: "ClearCredits" });
  }

  async getCommands() {
    return this.sendRequest({ request: "GetCommands" });
  }

  async getCodeTriggers() {
    return this.sendRequest({ request: "GetCodeTriggers" });
  }

  async executeCodeTrigger(triggerName: string, args?: Record<string, unknown>) {
    return this.sendRequest({
      request: "ExecuteCodeTrigger",
      triggerName,
      args: args ?? {},
    });
  }

  async twitchGetEmotes() {
    return this.sendRequest({ request: "TwitchGetEmotes" });
  }

  async youtubeGetEmotes() {
    return this.sendRequest({ request: "YouTubeGetEmotes" });
  }

  async getGlobals(persisted: boolean) {
    return this.sendRequest({ request: "GetGlobals", persisted });
  }

  async getGlobal(variable: string, persisted: boolean) {
    return this.sendRequest({ request: "GetGlobal", variable, persisted });
  }

  async twitchGetUserGlobals(variable: string, persisted: boolean) {
    return this.sendRequest({ request: "TwitchGetUserGlobals", variable, persisted });
  }

  async twitchGetUserGlobal(userId: string, persisted: boolean, variable?: string) {
    const req: Record<string, unknown> = {
      request: "TwitchGetUserGlobal",
      userId,
      persisted,
    };
    if (variable) req.variable = variable;
    return this.sendRequest(req as Omit<StreamerbotRequest, "id">);
  }

  async sendMessage(
    message: string,
    platform: "twitch" | "kick" | "youtube",
    bot = false,
    internal = false
  ) {
    return this.sendRequest({
      request: "SendMessage",
      platform,
      bot,
      internal,
      message,
    });
  }

  async getUserPronouns(userLogin: string, platform = "twitch") {
    return this.sendRequest({
      request: "GetUserPronouns",
      platform,
      userLogin,
    });
  }

  // ─── Event buffer access ─────────────────────────────────────────────────

  getBufferedEvents(
    limit = 50,
    filterSource?: string,
    filterType?: string
  ): BufferedEvent[] {
    let events = [...this.eventBuffer];
    if (filterSource) {
      events = events.filter((e) =>
        e.source.toLowerCase() === filterSource.toLowerCase()
      );
    }
    if (filterType) {
      events = events.filter((e) =>
        e.type.toLowerCase().includes(filterType.toLowerCase())
      );
    }
    return events.slice(-limit);
  }

  clearEventBuffer(): void {
    this.eventBuffer = [];
  }

  getSubscribedEvents(): Record<string, string[]> {
    return Object.fromEntries(this.subscribedEvents);
  }

  getConnectionInfo(): Record<string, unknown> {
    return {
      state: this.connectionState,
      host: this.config.host,
      port: this.config.port,
      endpoint: this.config.endpoint,
      autoReconnect: this.config.autoReconnect,
      bufferedEventCount: this.eventBuffer.length,
      subscribedCategories: this.subscribedEvents.size,
    };
  }
}
