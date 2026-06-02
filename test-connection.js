// Quick connectivity test — runs against a live Streamer.bot instance
// Usage: node test-connection.js
const WebSocket = require("ws");

const HOST = process.env.STREAMERBOT_HOST || "127.0.0.1";
const PORT = process.env.STREAMERBOT_PORT || "8080";
const url = `ws://${HOST}:${PORT}/`;

console.log(`Connecting to Streamer.bot at ${url} ...`);

const ws = new WebSocket(url);
let done = false;

function finish() {
  if (!done) {
    done = true;
    ws.close();
  }
}

ws.on("open", () => {
  console.log("✓ WebSocket connected\n");

  // Send GetInfo
  const id1 = "test-info-1";
  ws.send(JSON.stringify({ request: "GetInfo", id: id1 }));

  // Send GetActions
  const id2 = "test-actions-2";
  ws.send(JSON.stringify({ request: "GetActions", id: id2 }));

  // Send GetEvents
  const id3 = "test-events-3";
  ws.send(JSON.stringify({ request: "GetEvents", id: id3 }));
});

let responses = 0;
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.id === "test-info-1") {
    console.log("=== GetInfo ===");
    console.log(JSON.stringify(msg, null, 2));
    console.log();
  } else if (msg.id === "test-actions-2") {
    const actions = msg.actions || [];
    console.log(`=== GetActions === (${actions.length} actions)`);
    actions.slice(0, 5).forEach((a) => console.log(`  - [${a.id}] ${a.name} (group: ${a.group}, enabled: ${a.enabled})`));
    if (actions.length > 5) console.log(`  ... and ${actions.length - 5} more`);
    console.log();
  } else if (msg.id === "test-events-3") {
    const categories = Object.keys(msg.events || {});
    console.log(`=== GetEvents === (${categories.length} categories)`);
    categories.slice(0, 10).forEach((c) => console.log(`  - ${c}`));
    if (categories.length > 10) console.log(`  ... and ${categories.length - 10} more`);
    console.log();
  }

  responses++;
  if (responses >= 3) {
    console.log("✓ All tests passed — Streamer.bot MCP is fully operational!");
    finish();
  }
});

ws.on("error", (err) => {
  console.error("✗ Connection failed:", err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error("✗ Timed out waiting for responses");
  finish();
  process.exit(1);
}, 8000);
