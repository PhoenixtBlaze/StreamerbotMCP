const fs = require("fs");
let t = fs.readFileSync("E:/Files/Twich/Streamer.bot-x64-0.1.12/data/actions.json", "utf8");
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
const d = JSON.parse(t);
console.log("top keys:", Object.keys(d));
if (d.actions) {
  console.log("actions type:", Array.isArray(d.actions) ? "array" : typeof d.actions);
  if (Array.isArray(d.actions)) console.log("actions count:", d.actions.length);
  else console.log("actions object keys sample:", Object.keys(d.actions).slice(0, 5));
}
