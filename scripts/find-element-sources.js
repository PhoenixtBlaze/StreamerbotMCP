const fs = require("fs");
let t = fs.readFileSync("E:/Files/Twich/Streamer.bot-x64-0.1.12/data/actions.json", "utf8");
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
const hits = new Set();
for (const m of t.matchAll(/sourceName":"([^"]+)"/g)) {
  if (/element/i.test(m[1])) hits.add(m[1]);
}
console.log([...hits].sort().join("\n"));
