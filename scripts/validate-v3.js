/** Quick v3 acceptance checks (run after build). */
const fs = require("fs");
const path = require("path");

const indexSrc = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
const toolRe = /tool\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
const long = [];
let m;
while ((m = toolRe.exec(indexSrc))) {
  if (m[2].length > 160) long.push({ tool: m[1], len: m[2].length });
}

const instructions = fs.readFileSync(path.join(__dirname, "../src/instructions.ts"), "utf8");
const start = instructions.indexOf("export const AGENT_INSTRUCTIONS");
const end = instructions.indexOf("};", start);
const guideBlock = instructions.slice(start, end + 2);
const guideTokens = Math.ceil(guideBlock.length / 4);

console.log("Tool descriptions >160 chars:", long.length);
long.forEach((x) => console.log(" ", x.tool, x.len));
console.log("AGENT_INSTRUCTIONS ~tokens:", guideTokens, guideTokens < 600 ? "PASS" : "FAIL");

const doAction = indexSrc.match(/"do_action"[\s\S]*?"([^"]{20,})"/);
const testAction = indexSrc.match(/"test_action"[\s\S]*?"([^"]{20,})"/);
console.log("do_action mentions test_action:", /test_action/.test(doAction?.[1] ?? "") ? "PASS" : "FAIL");
console.log("test_action mentions do_action:", /do_action/.test(testAction?.[1] ?? "") ? "PASS" : "FAIL");
