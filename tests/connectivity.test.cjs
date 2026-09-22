const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = source.indexOf("function renderConnectivity() {");
const end = source.indexOf("// Monitora falta de novas leituras", start);
assert.ok(start >= 0 && end > start, "renderConnectivity precisa continuar testável");
const renderSource = source.slice(start, end);

function element() {
  const classes = new Set();
  return {
    hidden: true,
    textContent: "",
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

function check(name, overrides, expectedMode, expectedStale, expectedBanner) {
  const dom = Object.fromEntries([
    "reservoirCard", "pumpCard", "tankStaleLabel", "levelKicker", "pumpKicker",
    "readingModeLabel", "pumpStateDesc", "statusPill", "statusText",
    "connectivityBanner", "connectivityTitle", "connectivityMessage"
  ].map((key) => [key, element()]));
  const context = {
    Date,
    document: { body: element() },
    navigator: { onLine: true },
    dom,
    currentCondoId: "condominio_alpha",
    firebaseAuth: { currentUser: {} },
    firebaseReadError: null,
    firebaseTransportConnected: true,
    telemetryReceived: true,
    isDemoMode: false,
    lastHeartbeatTime: Date.now() - 2000,
    currentConnectivityMode: null,
    HEARTBEAT_TIMEOUT_MS: 18000,
    ...overrides
  };
  vm.runInNewContext(`${renderSource}\nrenderConnectivity();`, context);
  assert.equal(context.currentConnectivityMode, expectedMode, name);
  assert.equal(context.document.body.classList.contains("telemetry-stale"), expectedStale, name);
  assert.equal(!dom.connectivityBanner.hidden, expectedBanner, name);
}

check("leitura atual", {}, "online", false, false);
check("ESP32 sem novos envios", { lastHeartbeatTime: Date.now() - 19000 }, "device-offline", true, true);
check("navegador sem internet", { navigator: { onLine: false } }, "browser-offline", true, true);
check("Firebase sem conexão", { firebaseTransportConnected: false }, "cloud-offline", true, true);
check("erro de leitura", { firebaseReadError: "permission_denied" }, "read-error", true, true);
check("leitura sem relógio", { lastHeartbeatTime: null }, "verifying", true, true);
check("aguardando primeira leitura", { telemetryReceived: false, lastHeartbeatTime: null }, "waiting", false, false);
check("internet ausente antes do login", {
  navigator: { onLine: false }, firebaseAuth: { currentUser: null }, telemetryReceived: false
}, "browser-offline", false, true);

console.log("8 estados de conexão verificados.");
