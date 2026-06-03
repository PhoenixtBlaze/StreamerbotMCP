/**
 * Optional read-only index of actions.json when Streamer.bot is stopped.
 * Never write while Streamer.bot is running.
 */

import * as fs from "fs";
import * as path from "path";

export interface IndexedAction {
  id: string;
  name: string;
  group: string;
  enabled: boolean;
  trigger_count: number;
  subaction_count: number;
  triggers: Array<{ type?: number; eventName?: string; sceneName?: string; enabled?: boolean }>;
  subaction_summary: Array<{ type: number; enabled: boolean; label: string }>;
}

const SUBACTION_LABELS: Record<number, string> = {
  4: "Run Action",
  30: "OBS Set Source Visibility",
  35: "OBS Set Filter State",
  43: "OBS Get Context",
  120: "If Condition",
  99901: "Then branch",
  99902: "Else branch",
};

function labelSubAction(sa: Record<string, unknown>): string {
  const t = sa.type as number;
  let base = SUBACTION_LABELS[t] ?? `type ${t}`;
  if (t === 30 && sa.sourceName) base += `: ${sa.sourceName}`;
  if (t === 120 && sa.value) base += ` == ${sa.value}`;
  if (t === 4 && sa.actionId) base += ` → ${String(sa.actionId).slice(0, 8)}…`;
  return base;
}

function walkActions(data: unknown, found: IndexedAction[]): void {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) {
    for (const item of data) walkActions(item, found);
    return;
  }
  const obj = data as Record<string, unknown>;
  if (obj.id && obj.name && Array.isArray(obj.subActions)) {
    const triggers = Array.isArray(obj.triggers)
      ? (obj.triggers as Record<string, unknown>[]).map((t) => ({
          type: t.type as number | undefined,
          eventName: t.eventName as string | undefined,
          sceneName: t.sceneName as string | undefined,
          enabled: t.enabled as boolean | undefined,
        }))
      : [];
    const subActions = obj.subActions as Record<string, unknown>[];
    found.push({
      id: String(obj.id),
      name: String(obj.name),
      group: String(obj.group ?? ""),
      enabled: Boolean(obj.enabled),
      trigger_count: triggers.length,
      subaction_count: subActions.length,
      triggers,
      subaction_summary: subActions.slice(0, 20).map((sa) => ({
        type: sa.type as number,
        enabled: Boolean(sa.enabled ?? true),
        label: labelSubAction(sa),
      })),
    });
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "object") walkActions(v, found);
  }
}

export function loadActionsIndex(dataPath: string): {
  actions: IndexedAction[];
  warning?: string;
} {
  const file = path.join(dataPath, "actions.json");
  if (!fs.existsSync(file)) {
    return { actions: [], warning: `actions.json not found at ${file}` };
  }
  let raw = fs.readFileSync(file, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const data = JSON.parse(raw);
  const actions: IndexedAction[] = [];
  walkActions(data, actions);
  return {
    actions,
    warning:
      "Read-only index from disk. If Streamer.bot is running, use live API tools instead. Edits to actions.json require restarting Streamer.bot.",
  };
}

export function getActionDetail(
  dataPath: string,
  idOrName: string
): IndexedAction | null {
  const { actions } = loadActionsIndex(dataPath);
  const q = idOrName.toLowerCase();
  return (
    actions.find((a) => a.id === idOrName) ??
    actions.find((a) => a.name.toLowerCase() === q) ??
    null
  );
}
