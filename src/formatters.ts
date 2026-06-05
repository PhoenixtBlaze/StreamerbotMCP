import type { AppConfig } from "./config";
import { universalRedact } from "./safety";

export interface ActionSummary {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
  subaction_count?: number;
  trigger_count?: number;
}

export function compactAction(a: ActionSummary): Pick<ActionSummary, "id" | "name" | "group" | "enabled"> {
  return { id: a.id, name: a.name, group: a.group, enabled: a.enabled };
}

export function compactActions(actions: ActionSummary[]): Array<Pick<ActionSummary, "id" | "name" | "group" | "enabled">> {
  return actions.map(compactAction);
}

export function parseActionsList(res: Record<string, unknown>): ActionSummary[] {
  const actions = res.actions;
  if (!Array.isArray(actions)) return [];
  return actions.map((a: Record<string, unknown>) => ({
    id: String(a.id ?? ""),
    name: String(a.name ?? ""),
    group: String(a.group ?? ""),
    enabled: Boolean(a.enabled),
    subaction_count: a.subaction_count as number | undefined,
    trigger_count: a.trigger_count as number | undefined,
  }));
}

export function groupActions(actions: ActionSummary[]): Record<string, ActionSummary[]> {
  const out: Record<string, ActionSummary[]> = {};
  for (const a of actions) {
    const g = a.group || "(ungrouped)";
    if (!out[g]) out[g] = [];
    out[g].push(a);
  }
  return out;
}

export function summarizeGroups(actions: ActionSummary[]): Array<{
  group: string;
  total: number;
  enabled: number;
  disabled: number;
}> {
  const grouped = groupActions(actions);
  return Object.entries(grouped)
    .map(([group, list]) => ({
      group,
      total: list.length,
      enabled: list.filter((a) => a.enabled).length,
      disabled: list.filter((a) => !a.enabled).length,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

export function findActions(
  actions: ActionSummary[],
  query: string,
  group?: string
): ActionSummary[] {
  const q = query.toLowerCase();
  return actions.filter((a) => {
    if (group && a.group.toLowerCase() !== group.toLowerCase()) return false;
    return (
      a.name.toLowerCase().includes(q) ||
      a.group.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q)
    );
  });
}

export function findActionExact(actions: ActionSummary[], name: string): ActionSummary | undefined {
  const q = name.toLowerCase();
  return actions.find((a) => a.name.toLowerCase() === q || a.id === name);
}

/** @deprecated Prefer universalRedact via okText */
export function redactSecrets<T>(value: T, config: AppConfig): T {
  return universalRedact(value, config) as T;
}

export function stripNullUndefined(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(stripNullUndefined).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNullUndefined(v);
    }
    return out;
  }
  return value;
}

export interface EventSummary {
  total: number;
  by_source: Record<string, Record<string, number>>;
  last_event: { source: string; type: string; timestamp: string } | null;
}

export function summarizeEvents(
  events: Array<{ timestamp: string; source: string; type: string; data: Record<string, unknown> }>
): EventSummary {
  const by_source: Record<string, Record<string, number>> = {};
  for (const e of events) {
    if (!by_source[e.source]) by_source[e.source] = {};
    by_source[e.source][e.type] = (by_source[e.source][e.type] ?? 0) + 1;
  }
  const last = events.length > 0 ? events[events.length - 1] : null;
  return {
    total: events.length,
    by_source,
    last_event: last ? { source: last.source, type: last.type, timestamp: last.timestamp } : null,
  };
}

export function scoreTextMatch(text: string, goal: string): number {
  const hay = text.toLowerCase();
  const tokens = goal
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  return score;
}

export function formatBroadcaster(raw: Record<string, unknown>): Array<{
  platform: string;
  username: string;
  display_name: string;
  connected: boolean;
}> {
  const accounts: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw.accounts)) {
    accounts.push(...(raw.accounts as Record<string, unknown>[]));
  } else if (Array.isArray(raw.broadcasters)) {
    accounts.push(...(raw.broadcasters as Record<string, unknown>[]));
  } else if (raw.platform) {
    accounts.push(raw);
  }

  return accounts.map((a) => ({
    platform: String(a.platform ?? a.service ?? "unknown"),
    username: String(a.login ?? a.username ?? a.name ?? ""),
    display_name: String(a.displayName ?? a.display_name ?? a.login ?? ""),
    connected: Boolean(a.connected ?? a.isConnected ?? true),
  }));
}

export function formatCommands(raw: Record<string, unknown>): {
  count: number;
  commands: Array<{ trigger: string; action_name: string; enabled: boolean }>;
} {
  const list = (raw.commands ?? raw) as unknown;
  if (!Array.isArray(list)) {
    return { count: 0, commands: [] };
  }
  const commands = list.map((c: Record<string, unknown>) => ({
    trigger: String(c.command ?? c.name ?? c.trigger ?? ""),
    action_name: String(c.actionName ?? c.action_name ?? c.action ?? ""),
    enabled: Boolean(c.enabled ?? true),
  }));
  return { count: commands.length, commands };
}

export function formatGlobals(raw: Record<string, unknown>): {
  count: number;
  variables: Array<{ name: string; value: unknown; persisted: boolean }>;
} {
  const vars = raw.variables ?? raw.globals ?? raw;
  if (Array.isArray(vars)) {
    const variables = vars.map((v: Record<string, unknown>) => ({
      name: String(v.name ?? v.variable ?? ""),
      value: v.value,
      persisted: Boolean(v.persisted ?? true),
    }));
    return { count: variables.length, variables };
  }
  if (typeof vars === "object" && vars !== null) {
    const variables = Object.entries(vars as Record<string, unknown>).map(([name, value]) => ({
      name,
      value,
      persisted: Boolean(raw.persisted ?? true),
    }));
    return { count: variables.length, variables };
  }
  return { count: 0, variables: [] };
}

export function textResult(data: unknown): string {
  return JSON.stringify(data);
}
