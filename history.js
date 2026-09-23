export const HISTORY_INTERVAL_MS = 15 * 60 * 1000;

export function parseHistory(raw, startMs = 0, endMs = Infinity) {
  if (!raw || typeof raw !== "object") return [];
  return Object.values(raw).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const timestamp = Number(value.timestamp_ms);
    const level = Number(value.nivel_percent);
    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp > endMs ||
        !Number.isFinite(level) || level < 0 || level > 100) return [];
    return [{
      timestamp,
      level,
      valid: value.nivel_valido === true,
      pumpOn: value.bomba_ligada === true,
      current: Number.isFinite(Number(value.corrente_a)) ? Math.max(0, Number(value.corrente_a)) : null,
      alert: typeof value.alerta === "string" ? value.alerta : "OK",
      deviceId: typeof value.dispositivo_id === "string" ? value.dispositivo_id : "esp32_principal"
    }];
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export function summarizeHistory(samples, startMs, endMs) {
  const valid = samples.filter((sample) => sample.valid);
  const levels = valid.map((sample) => sample.level);
  const expected = Math.max(1, Math.ceil((endMs - startMs) / HISTORY_INTERVAL_MS));
  const minimum = levels.reduce((value, level) => Math.min(value, level), Infinity);
  const maximum = levels.reduce((value, level) => Math.max(value, level), -Infinity);
  let pumpStartsObserved = 0;
  let alertTransitionsObserved = 0;
  for (let i = 1; i < samples.length; i += 1) {
    // Long gaps cannot establish the transition time or even that no other
    // transitions occurred between the two samples.
    if (samples[i].timestamp - samples[i - 1].timestamp > HISTORY_INTERVAL_MS * 2.5) continue;
    if (!samples[i - 1].pumpOn && samples[i].pumpOn) pumpStartsObserved += 1;
    if (samples[i].alert !== "OK" && samples[i].alert !== samples[i - 1].alert) {
      alertTransitionsObserved += 1;
    }
  }
  return {
    count: samples.length,
    coverage: Math.min(100, Math.round(samples.length / expected * 100)),
    average: levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : null,
    minimum: levels.length ? minimum : null,
    maximum: levels.length ? maximum : null,
    estimatedPumpHours: samples.filter((sample) => sample.pumpOn).length * HISTORY_INTERVAL_MS / 3600000,
    pumpStartsObserved,
    alertTransitionsObserved
  };
}

export function buildChartPath(samples, startMs, endMs, width = 800, height = 180) {
  const span = Math.max(1, endMs - startMs);
  let previous = null;
  let path = "";
  for (const sample of samples) {
    if (!sample.valid) {
      previous = null;
      continue;
    }
    const x = Math.max(0, Math.min(width, (sample.timestamp - startMs) / span * width));
    const y = (100 - sample.level) / 100 * height;
    const connected = previous && sample.timestamp - previous.timestamp <= HISTORY_INTERVAL_MS * 2.5;
    path += `${connected ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    previous = sample;
  }
  return path.trim();
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createReportCsv(condoId, periodLabel, samples, summary, startMs, endMs) {
  const lines = [
    ["SmartWater Web", "Relatório de amostras"],
    ["Condomínio", condoId],
    ["Período", periodLabel],
    ["Início", new Date(startMs).toISOString()],
    ["Fim", new Date(endMs).toISOString()],
    ["Cobertura estimada (%)", summary.coverage],
    ["Nível médio (%)", summary.average?.toFixed(1) ?? ""],
    ["Nível mínimo (%)", summary.minimum?.toFixed(1) ?? ""],
    ["Nível máximo (%)", summary.maximum?.toFixed(1) ?? ""],
    ["Bomba ligada (horas estimadas)", summary.estimatedPumpHours.toFixed(2)],
    ["Acionamentos observados", summary.pumpStartsObserved],
    ["Alertas observados", summary.alertTransitionsObserved],
    ["Observação", "Amostras a cada 15 minutos; eventos breves podem não aparecer. Lacunas indicam ausência de dados, não nível zero."],
    [],
    ["Data/hora", "Nível (%)", "Leitura válida", "Bomba ligada", "Corrente (A)", "Alerta", "Dispositivo"]
  ];
  for (const sample of samples) {
    lines.push([
      new Date(sample.timestamp).toISOString(), sample.valid ? sample.level.toFixed(1) : "",
      sample.valid ? "sim" : "não", sample.pumpOn ? "sim" : "não",
      sample.current?.toFixed(2) ?? "", sample.alert, sample.deviceId
    ]);
  }
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
}
