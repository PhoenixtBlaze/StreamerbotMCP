import type { AppConfig } from "./config";

export interface ActionSummary {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
  subaction_count?: number;
  trigger_count?: number;
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

export function redactSecrets<T>(value: T, config: AppConfig): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (config.secretPatterns.some((p) => p.test(value)) && value.length > 8) {
      return "[REDACTED]" as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, config)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (config.secretPatterns.some((p) => p.test(k))) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecrets(v, config);
      }
    }
    return out as T;
  }
  return value;
}

export function summarizeEvents(
  events: Array<{ timestamp: string; source: string; type: string; data: Record<string, unknown> }>
): {
  total: number;
  bySource: Record<string, { count: number; types: string[]; latest?: string }>;
  samples: Array<{ source: string; type: string; timestamp: string; keys: string[] }>;
} {
  const bySource: Record<string, { count: number; types: Set<string>; latest?: string }> = {};
  for (const e of events) {
    if (!bySource[e.source]) {
      bySource[e.source] = { count: 0, types: new Set() };
    }
    bySource[e.source].count++;
    bySource[e.source].types.add(e.type);
    bySource[e.source].latest = e.timestamp;
  }
  const bySourceOut: Record<string, { count: number; types: string[]; latest?: string }> = {};
  for (const [k, v] of Object.entries(bySource)) {
    bySourceOut[k] = { count: v.count, types: [...v.types], latest: v.latest };
  }
  const samples = events.slice(-10).map((e) => ({
    source: e.source,
    type: e.type,
    timestamp: e.timestamp,
    keys: Object.keys(e.data).slice(0, 12),
  }));
  return { total: events.length, bySource: bySourceOut, samples };
}

export function textResult(data: unknown, compact = true): string {
  return JSON.stringify(data, null, compact ? 2 : 2);
}
