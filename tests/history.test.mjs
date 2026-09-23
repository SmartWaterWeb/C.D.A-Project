import assert from "node:assert/strict";
import { HISTORY_INTERVAL_MS, parseHistory, summarizeHistory, buildChartPath, createReportCsv } from "../history.js";

const start = Date.UTC(2026, 8, 23, 0, 0, 0);
const interval = HISTORY_INTERVAL_MS;
const raw = {
  later: { timestamp_ms: start + interval * 2, nivel_percent: 55, nivel_valido: true, bomba_ligada: true, corrente_a: 4.2, alerta: "NIVEL_CRITICO_BAIXO", dispositivo_id: "esp32_principal" },
  first: { timestamp_ms: start, nivel_percent: 50, nivel_valido: true, bomba_ligada: false, corrente_a: 0, alerta: "OK" },
  second: { timestamp_ms: start + interval, nivel_percent: 52, nivel_valido: true, bomba_ligada: true, corrente_a: 4.1, alerta: "OK" },
  invalid: { timestamp_ms: start + interval * 3, nivel_percent: 101, nivel_valido: true, bomba_ligada: true },
  outside: { timestamp_ms: start - interval, nivel_percent: 30, nivel_valido: true, bomba_ligada: false }
};
const samples = parseHistory(raw, start, start + interval * 4);
assert.equal(samples.length, 3);
assert.deepEqual(samples.map((sample) => sample.level), [50, 52, 55]);
const summary = summarizeHistory(samples, start, start + interval * 4);
assert.equal(summary.coverage, 75);
assert.equal(summary.minimum, 50);
assert.equal(summary.maximum, 55);
assert.equal(summary.pumpStartsObserved, 1);
assert.equal(summary.alertTransitionsObserved, 1);
assert.equal(summary.estimatedPumpHours, 0.5);
assert.match(buildChartPath(samples, start, start + interval * 4), /^M/);
assert.equal(buildChartPath([], start, start + interval), "");
assert.equal(summarizeHistory([], start, start + interval).average, null);
assert.equal(summarizeHistory([], start, start + interval).coverage, 0);
assert.equal(summarizeHistory([
  samples[0], { ...samples[2], timestamp: start + interval * 5 }
], start, start + interval * 6).pumpStartsObserved, 0, "não contar transição através de lacuna longa");
assert.equal((buildChartPath([
  samples[0], { ...samples[2], timestamp: start + interval * 5 }
], start, start + interval * 6).match(/M/g) || []).length, 2, "não desenhar linha atravessando lacuna longa");
const csv = createReportCsv("condominio_alpha", "Últimos 7 dias", samples, summary, start, start + interval * 4);
assert.match(csv, /Cobertura estimada/);
assert.match(csv, /esp32_principal/);
assert.match(csv, /Eventos breves|eventos breves/);
assert.ok(!csv.includes("undefined"));
const safeCsv = createReportCsv("condominio_alpha", "Teste", [{ ...samples[0], alert: "=FORMULA()" }], summary, start, start + interval);
assert.match(safeCsv, /'=FORMULA\(\)/, "texto exportado não deve virar fórmula de planilha");
console.log("Histórico, cobertura, lacunas e relatório verificados.");
