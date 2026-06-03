import type { StreamerbotClient } from "./client";
import { redactSecrets, textResult } from "./formatters";
import type { AppConfig } from "./config";

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function okText(data: unknown, config?: AppConfig, redact = false): {
  content: { type: "text"; text: string }[];
} {
  const payload = redact && config ? redactSecrets(data, config) : data;
  return { content: [{ type: "text", text: textResult(payload) }] };
}

export function errText(msg: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return { content: [{ type: "text", text: msg }], isError: true };
}

export async function ensureConnected(client: StreamerbotClient): Promise<void> {
  if (!client.isConnected) {
    await client.connect();
  }
}

/** Destructive operations require explicit confirm flag */
export function requireConfirm(
  confirm: boolean | undefined,
  operation: string
): string | null {
  if (!confirm) {
    return `${operation} requires confirm=true. This is a destructive or public-facing operation.`;
  }
  return null;
}
