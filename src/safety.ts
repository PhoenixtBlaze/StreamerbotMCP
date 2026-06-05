/**
 * Safety: destructive op registry, universal secret redaction.
 */

import type { AppConfig } from "./config";

export interface DestructiveOp {
  label: string;
  requiresConfirm: boolean;
}

export const DESTRUCTIVE_OPS: Record<string, DestructiveOp> = {
  send_message: { label: "Send public chat message", requiresConfirm: true },
  clear_credits: { label: "Wipe stream credits", requiresConfirm: true },
  disconnect: { label: "Disconnect from Streamer.bot", requiresConfirm: false },
  do_action: { label: "Execute live action", requiresConfirm: false },
};

const SENSITIVE_KEY = /token|password|secret|api.?key|auth/i;

export function universalRedact(payload: unknown, config: AppConfig): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === "string") {
    if (config.secretPatterns.some((p) => p.test(payload)) && payload.length > 8) {
      return "[REDACTED]";
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((v) => universalRedact(v, config));
  }
  if (typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) || config.secretPatterns.some((p) => p.test(k))) {
        out[k] = "[REDACTED]";
      } else if (typeof v === "string" && config.secretPatterns.some((p) => p.test(v)) && v.length > 8) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = universalRedact(v, config);
      }
    }
    return out;
  }
  return payload;
}

export function getDestructiveOp(name: string): DestructiveOp | undefined {
  return DESTRUCTIVE_OPS[name];
}
