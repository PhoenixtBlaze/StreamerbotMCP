import type { StreamerbotClient } from "./client";
import {
  stripNullUndefined,
  textResult,
} from "./formatters";
import type { AppConfig } from "./config";
import { universalRedact, getDestructiveOp } from "./safety";

export interface ClassifiedError {
  error: string;
  fix: string;
  code?: string;
}

export function classifyError(err: unknown): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("not connected") || lower.includes("websocket")) {
    return { error: msg, fix: "Run connect or validate_setup", code: "NOT_CONNECTED" };
  }
  if (lower.includes("action not found") || lower.includes("could not find action")) {
    return { error: msg, fix: "Run find_actions with a keyword to locate it", code: "ACTION_NOT_FOUND" };
  }
  if (lower.includes("bridge") || lower.includes("mcp set global")) {
    return {
      error: msg,
      fix: "Run get_bridge_setup_guide and create the action in Streamer.bot UI first",
      code: "BRIDGE_NOT_FOUND",
    };
  }
  if (lower.includes("confirm=true") || lower.includes("requires confirm")) {
    return { error: msg, fix: "Set confirm=true to proceed", code: "CONFIRM_REQUIRED" };
  }
  if (lower.includes("disk") && lower.includes("stale")) {
    return {
      error: msg,
      fix: "Stop Streamer.bot before reading disk, or use get_actions for live data",
      code: "DISK_STALE_RISK",
    };
  }
  if (lower.includes("http") && (lower.includes("fetch") || lower.includes("unavailable") || lower.includes("econnrefused"))) {
    return {
      error: msg,
      fix: "Enable HTTP Server in Streamer.bot Servers/Clients, then validate_setup",
      code: "HTTP_UNAVAILABLE",
    };
  }
  if (lower.includes("too many subscription") || lower.includes("rate limit")) {
    return { error: msg, fix: "Wait 10 seconds before resubscribing", code: "RATE_LIMITED" };
  }
  if (lower.includes("unknown template") || lower.includes("invalid template")) {
    return { error: msg, fix: "Call list_csharp_templates first", code: "TEMPLATE_NOT_FOUND" };
  }
  if (lower.includes("timed out")) {
    return { error: msg, fix: "Check Streamer.bot is running and WebSocket Server is started", code: "TIMEOUT" };
  }

  return { error: msg, fix: "Run validate_setup to diagnose connection and configuration", code: "UNKNOWN" };
}

/** @deprecated Use classifyError */
export function formatError(err: unknown): string {
  const c = classifyError(err);
  return c.error;
}

export interface OkTextOptions {
  skipRedact?: boolean;
}

export function okText(
  data: unknown,
  config?: AppConfig,
  options?: OkTextOptions
): { content: { type: "text"; text: string }[] } {
  let payload = stripNullUndefined(data);
  if (config && !options?.skipRedact) {
    payload = universalRedact(payload, config);
  }
  return { content: [{ type: "text", text: textResult(payload) }] };
}

export function errText(err: unknown | ClassifiedError | string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  const classified =
    typeof err === "string"
      ? { error: err, fix: "Review the error and retry with corrected parameters" }
      : typeof err === "object" && err !== null && "error" in err
        ? (err as ClassifiedError)
        : classifyError(err);
  return {
    content: [{ type: "text", text: textResult(classified) }],
    isError: true,
  };
}

export async function ensureConnected(client: StreamerbotClient): Promise<void> {
  if (!client.isConnected) {
    await client.connect();
  }
}

export function requireConfirm(
  confirm: boolean | undefined,
  operation: string
): ClassifiedError | null {
  const op = getDestructiveOp(operation);
  if (op?.requiresConfirm !== false && !confirm) {
    return {
      error: `${operation} requires confirm=true${op ? ` (${op.label})` : ""}.`,
      fix: "Set confirm=true to proceed",
      code: "CONFIRM_REQUIRED",
    };
  }
  return null;
}

export function catchErr(e: unknown): ReturnType<typeof errText> {
  return errText(classifyError(e));
}
