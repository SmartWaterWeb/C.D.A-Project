const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const ids = [...app.matchAll(/document\.getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
assert.deepEqual(missing, [], `Elementos ausentes no HTML: ${missing.join(", ")}`);
assert.match(html, /src="\.\/app\.js/);
assert.match(app, /from "\.\/history\.js"/);
console.log(`${ids.length} referências de elementos verificadas.`);
