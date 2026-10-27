const CONNECTION_MESSAGES = {
  "browser-offline": ["Este aparelho está sem internet", "O painel não pode confirmar novas leituras enquanto a conexão não voltar."],
  "cloud-offline": ["Firebase desconectado", "Os dados exibidos são os últimos conhecidos; a comunicação com o banco foi interrompida."],
  "read-error": ["Leitura indisponível", "Não foi possível consultar a telemetria deste condomínio. Verifique conexão e permissões."],
  "device-offline": ["ESP32 sem novas leituras", "O controlador pode estar sem energia ou internet. A última leitura não confirma o estado atual."]
};

export function currentConditions(data, connectivityMode) {
  if (CONNECTION_MESSAGES[connectivityMode]) {
    const [title, detail] = CONNECTION_MESSAGES[connectivityMode];
    return [{ key: "connection", severity: connectivityMode === "device-offline" ? "urgent" : "attention", title, detail }];
  }
  if (connectivityMode !== "online" || !data) return [];

  const conditions = [];
  const level = Number(data.nivel_percent);
  const levelValid = data.nivel_valido !== false && data.alerta !== "FALHA_SENSOR_NIVEL";
  if (!levelValid) {
    conditions.push({ key: "sensor-level", severity: "urgent", title: "Sensor de nível sem leitura", detail: "Não há nível atual confiável. Confira a alimentação e a instalação do sensor." });
  }
  if (data.alerta === "SOBRECARGA_BOMBA") {
    conditions.push({ key: "pump-overload", severity: "urgent", title: "Corrente alta na bomba", detail: "Verifique a bomba e a instalação elétrica com um profissional habilitado." });
  }
  if (levelValid && Number.isFinite(level) && (level <= 20 || data.alerta === "NIVEL_CRITICO_BAIXO")) {
    conditions.push({ key: "low-level", severity: "urgent", title: "Nível de água crítico", detail: `Reservatório em ${level.toFixed(1)}%. Há risco de desabastecimento.` });
  }
  if (levelValid && Number.isFinite(level) && (level >= 95 || data.alerta === "RISCO_TRANSBORDAMENTO")) {
    conditions.push({ key: "high-level", severity: "attention", title: "Reservatório próximo do limite", detail: `Reservatório em ${level.toFixed(1)}%. Confira o desligamento automático da bomba.` });
  }
  return conditions;
}

export function reconcileConditions(active, resolved, nextConditions, nowMs, maxResolved = 8) {
  const oldByKey = new Map(active.map((item) => [item.key, item]));
  const nextActive = nextConditions.map((item) => ({ ...item, since: oldByKey.get(item.key)?.since ?? nowMs }));
  const nextKeys = new Set(nextActive.map((item) => item.key));
  const newlyResolved = active.filter((item) => !nextKeys.has(item.key))
    .map((item) => ({ ...item, resolvedAt: nowMs }));
  return { active: nextActive, resolved: [...newlyResolved, ...resolved].slice(0, maxResolved) };
}
