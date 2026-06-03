/**
 * Patch Streamer.bot actions for StreamElements overlay visibility:
 * - scene changed: hide overlay on every scene switch (before scene branches)
 * - Scene ingame: show overlay when entering ingame
 */
const fs = require("fs");
const crypto = require("crypto");
const uuid = () => crypto.randomUUID();

const ACTIONS_PATH = "E:/Files/Twich/Streamer.bot-x64-0.1.12/data/actions.json";
const BACKUP_PATH = ACTIONS_PATH + ".pre-se-overlay.bak";
const OBS_CONNECTION = "ba21ad3b-f94f-46f8-a5ea-c6a64e48381e";
const SCENE = "ingame";
const SOURCE = "streamelementsoverlay";

let raw = fs.readFileSync(ACTIONS_PATH, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const data = JSON.parse(raw);

const sceneChanged = data.actions.find((a) => a.id === "3d77faff-ff26-426a-b882-642c02813eeb");
const sceneIngame = data.actions.find((a) => a.id === "01a2bd2a-167f-4def-9b0d-44d3b1c6ae3f");

if (!sceneChanged || !sceneIngame) {
  console.error("Could not find scene changed or Scene ingame actions");
  process.exit(1);
}

function hasOverlaySubAction(action, state) {
  return action.subActions?.some(
    (s) =>
      s.type === 30 &&
      s.sceneName === SCENE &&
      s.sourceName === SOURCE &&
      s.state === state
  );
}

const hideSubAction = {
  sceneName: SCENE,
  sourceName: SOURCE,
  state: 0,
  connectionId: OBS_CONNECTION,
  id: uuid(),
  weight: 0,
  type: 30,
  parentId: null,
  enabled: true,
};

const showSubAction = {
  sceneName: SCENE,
  sourceName: SOURCE,
  state: 1,
  connectionId: OBS_CONNECTION,
  id: uuid(),
  weight: 0,
  type: 30,
  parentId: null,
  enabled: true,
};

let changed = false;

if (!hasOverlaySubAction(sceneChanged, 0)) {
  // Insert hide right after the first sub-action (type 43 — sets up scene context)
  sceneChanged.subActions.splice(1, 0, { ...hideSubAction, index: 1 });
  sceneChanged.subActions.forEach((s, i) => {
    s.index = i;
  });
  changed = true;
  console.log("Added hide overlay to 'scene changed'");
} else {
  console.log("'scene changed' already has hide overlay sub-action");
}

if (!hasOverlaySubAction(sceneIngame, 1)) {
  const idx = sceneIngame.subActions.length;
  sceneIngame.subActions.push({ ...showSubAction, index: idx });
  changed = true;
  console.log("Added show overlay to 'Scene ingame'");
} else {
  console.log("'Scene ingame' already has show overlay sub-action");
}

if (!changed) {
  console.log("No changes needed.");
  process.exit(0);
}

if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(ACTIONS_PATH, BACKUP_PATH);
  console.log("Backup written:", BACKUP_PATH);
}

const out = JSON.stringify(data);
fs.writeFileSync(ACTIONS_PATH, out, "utf8");
console.log("Updated actions.json successfully.");
console.log("Restart Streamer.bot or use Actions > Reload if available for changes to take effect.");
