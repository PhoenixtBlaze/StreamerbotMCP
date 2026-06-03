import WebSocket from "ws";
import { EventEmitter } from "events";
import * as crypto from "crypto";
import type { AppConfig } from "./config";
import { loadConfig } from "./config";

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

export interface BufferedEvent {
  timestamp: string;
  source: string;
  type: string;
  data: Record<string, unknown>;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticated";

interface PendingRequest {
  resolve: (value: StreamerbotResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class StreamerbotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: AppConfig;
  private pendingRequests = new Map<string, PendingRequest>();
  private connectionState: ConnectionState = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private eventBuffer: BufferedEvent[] = [];
  private subscribedEvents = new Map<string, string[]>();
  private autoReconnect: boolean;
  private reconnectInterval: number;
  private authRequired = false;
  private authenticated = false;
  private connectPromise: Promise<void> | null = null;
  private lastScene: { name?: string; timestamp: string } | null = null;
  private cachedEventCategories: Record<string, string[]> | null = null;

  constructor(config?: Partial<AppConfig> & { autoReconnect?: boolean; reconnectInterval?: number }) {
    super();
    this.config = loadConfig(config);
    this.autoReconnect = config?.autoReconnect ?? true;
    this.reconnectInterval = config?.reconnectInterval ?? 5000;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get isConnected(): boolean {
    return this.connectionState === "connected" || this.connectionState === "authenticated";
  }

  getConfig(): AppConfig {
    return this.config;
  }

  updateConfig(partial: Partial<AppConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getLastScene(): { name?: string; timestamp: string } | null {
    return this.lastScene;
  }

  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._connectInternal().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private _connectInternal(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.config.host}:${this.config.wsPort}${this.config.endpoint}`;
      this.connectionState = "connecting";
      this.authenticated = false;
      this.emit("connecting", url);

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        this.connectionState = "disconnected";
        reject(new Error(`Failed to create WebSocket: ${err}`));
        return;
      }

      const authTimeout = setTimeout(() => {
        if (this.connectionState === "connecting") {
          reject(new Error("Connection timed out waiting for Streamer.bot handshake"));
          this.ws?.close();
        }
      }, 15000);

      const onHello = (raw: string) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return;
        }

        // Hello packet (v0.2.5+) — may include authentication challenge
        if (msg.authentication && typeof msg.authentication === "object") {
          const auth = msg.authentication as { salt?: string; challenge?: string };
          this.authRequired = true;
          if (!this.config.password) {
            clearTimeout(authTimeout);
            reject(new Error("Streamer.bot requires WebSocket password (set STREAMERBOT_PASSWORD)"));
            this.ws?.close();
            return;
          }
          this.authenticate(auth.salt ?? "", auth.challenge ?? "")
            .then(() => {
              clearTimeout(authTimeout);
              this.connectionState = "authenticated";
              this.authenticated = true;
              this.emit("connected");
              resolve();
            })
            .catch((e) => {
              clearTimeout(authTimeout);
              reject(e);
            });
          return;
        }

        // No auth — ready immediately
        clearTimeout(authTimeout);
        this.connectionState = "connected";
        this.emit("connected");
        resolve();
      };

      let helloHandled = false;
      const messageHandler = (data: WebSocket.RawData) => {
        const raw = data.toString();
        if (!helloHandled) {
          helloHandled = true;
          try {
            const msg = JSON.parse(raw) as Record<string, unknown>;
            if (msg.authentication !== undefined || msg.info !== undefined) {
              onHello(raw);
              return;
            }
          } catch {
            /* fall through */
          }
        }
        this.handleMessage(raw);
      };

      this.ws.on("message", messageHandler);

      this.ws.once("open", () => {
        // If no hello within 2s, assume legacy server without auth handshake
        setTimeout(() => {
          if (!helloHandled && this.connectionState === "connecting") {
            helloHandled = true;
            clearTimeout(authTimeout);
            this.connectionState = "connected";
            this.emit("connected");
            resolve();
          }
        }, 2000);
      });

      this.ws.once("error", (err: Error) => {
        clearTimeout(authTimeout);
        this.connectionState = "disconnected";
        this.emit("error", err);
        reject(err);
        if (this.autoReconnect) this.scheduleReconnect();
      });

      this.ws.on("close", () => {
        this.connectionState = "disconnected";
        this.authenticated = false;
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket connection closed"));
          this.pendingRequests.delete(id);
        }
        this.emit("disconnected");
        if (this.autoReconnect) this.scheduleReconnect();
      });
    });
  }

  /** OBS WebSocket 5–style auth used by Streamer.bot v0.2.5+ */
  private async authenticate(salt: string, challenge: string): Promise<void> {
    const password = this.config.password ?? "";
    const secret = password + salt;
    const hash = crypto.createHash("sha256").update(secret, "utf8").digest("base64");
    const challengeHash = crypto
      .createHash("sha256")
      .update(hash + challenge, "utf8")
      .digest("base64");

    const res = await this.sendRequest({
      request: "Authenticate",
      authentication: challengeHash,
    } as Omit<StreamerbotRequest, "id">);

    if (res.status === "error") {
      throw new Error((res.error as string) ?? "Authentication failed");
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, this.reconnectInterval);
  }

  disconnect(): void {
    this.autoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.connectionState = "disconnected";
    this.authenticated = false;
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

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

    if (msg.event && typeof msg.event === "object") {
      const eventObj = msg.event as { source?: string; type?: string };
      const source = eventObj.source ?? "Unknown";
      const type = eventObj.type ?? "Unknown";
      const data = (msg.data as Record<string, unknown>) ?? {};

      const buffered: BufferedEvent = {
        timestamp: new Date().toISOString(),
        source,
        type,
        data,
      };
      this.eventBuffer.push(buffered);
      if (this.eventBuffer.length > this.config.eventBufferSize) {
        this.eventBuffer.shift();
      }

      if (source === "Obs" && type === "SceneChanged") {
        const scene =
          (data.sceneName as string) ??
          (data.scene as string) ??
          (data.currentScene as string);
        if (scene) {
          this.lastScene = { name: scene, timestamp: buffered.timestamp };
        }
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
        reject(
          new Error(
            "Not connected to Streamer.bot. Ensure it is running and WebSocket Server is started (Servers/Clients)."
          )
        );
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

  async doActionHttp(
    actionIdOrName: string,
    args?: Record<string, unknown>,
    byId = false
  ): Promise<{ status: number; ok: boolean }> {
    const action = byId ? { id: actionIdOrName } : { name: actionIdOrName };
    const url = `http://${this.config.host}:${this.config.httpPort}/DoAction`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, args: args ?? {} }),
    });
    return { status: res.status, ok: res.ok || res.status === 204 };
  }

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
    return this.sendRequest({ request: "GetActions" }, 30000);
  }

  async doAction(actionIdOrName: string, args?: Record<string, unknown>, byId = true) {
    const action = byId ? { id: actionIdOrName } : { name: actionIdOrName };
    return this.sendRequest({
      request: "DoAction",
      action,
      args: args ?? {},
    });
  }

  async getEvents(): Promise<StreamerbotResponse & { events?: Record<string, string[]> }> {
    const res = await this.sendRequest({ request: "GetEvents" });
    if (res.events && typeof res.events === "object") {
      this.cachedEventCategories = res.events as Record<string, string[]>;
    }
    return res;
  }

  async subscribeToEvents(events: Record<string, string[]>) {
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

  async subscribeToAll(): Promise<StreamerbotResponse> {
    if (!this.cachedEventCategories) {
      await this.getEvents();
    }
    const categories = this.cachedEventCategories ?? {};
    const allEvents: Record<string, string[]> = {};
    for (const cat of Object.keys(categories)) {
      allEvents[cat] = ["*"];
    }
    if (Object.keys(allEvents).length === 0) {
      // Fallback if GetEvents failed
      const fallback = [
        "Application", "Command", "CrowdControl", "Custom", "DonorDrive", "Elgato",
        "FileTail", "FileWatcher", "Fourthwall", "General", "Group", "HypeRate",
        "Inputs", "Kick", "KoFi", "MeldStudio", "MIDI", "Misc", "OBS", "Obs",
        "Pallygg", "Patreon", "Pulsoid", "Quote", "Raw", "Shopify", "SpeakerBot",
        "SpeechToText", "StreamDeck", "StreamElements", "StreamLoots", "Streamerbot",
        "StreamerbotRemote", "Streamlabs", "StreamlabsDesktop", "System", "TipeeeStream",
        "TITS", "TreatStream", "Twitch", "Trovo", "ThrowingSystem", "Voicemod",
        "VTubeStudio", "WebsocketClient", "WebsocketCustomServer", "YouTube",
      ];
      for (const cat of fallback) allEvents[cat] = ["*"];
    }
    return this.subscribeToEvents(allEvents);
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

  getBufferedEvents(limit = 50, filterSource?: string, filterType?: string): BufferedEvent[] {
    let events = [...this.eventBuffer];
    if (filterSource) {
      events = events.filter((e) => e.source.toLowerCase() === filterSource.toLowerCase());
    }
    if (filterType) {
      events = events.filter((e) => e.type.toLowerCase().includes(filterType.toLowerCase()));
    }
    return events.slice(-limit);
  }

  waitForEvent(
    options: {
      source?: string;
      type?: string;
      timeoutMs?: number;
    } = {}
  ): Promise<BufferedEvent | null> {
    const { source, type, timeoutMs = 30000 } = options;
    const existing = this.getBufferedEvents(500, source, type);
    if (existing.length > 0) {
      return Promise.resolve(existing[existing.length - 1]);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off("event", handler);
        resolve(null);
      }, timeoutMs);

      const handler = (e: BufferedEvent) => {
        if (source && e.source.toLowerCase() !== source.toLowerCase()) return;
        if (type && !e.type.toLowerCase().includes(type.toLowerCase())) return;
        clearTimeout(timer);
        this.off("event", handler);
        resolve(e);
      };
      this.on("event", handler);
    });
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
      authenticated: this.authenticated,
      host: this.config.host,
      wsPort: this.config.wsPort,
      httpPort: this.config.httpPort,
      endpoint: this.config.endpoint,
      autoReconnect: this.autoReconnect,
      bufferedEventCount: this.eventBuffer.length,
      subscribedCategories: this.subscribedEvents.size,
      lastScene: this.lastScene,
      dataPath: this.config.dataPath ?? null,
      bridgeActions: this.config.bridgeActions,
      primitives: this.config.primitives,
    };
  }
}
