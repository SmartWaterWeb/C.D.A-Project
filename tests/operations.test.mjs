import assert from "node:assert/strict";
import { currentConditions, reconcileConditions } from "../operations.js";

assert.deepEqual(currentConditions({ nivel_percent: 12, nivel_valido: true }, "device-offline").map((item) => item.key), ["connection"], "leitura antiga não deve ser apresentada como alerta atual");
assert.deepEqual(currentConditions({ nivel_percent: 12, nivel_valido: true, alerta: "OK" }, "online").map((item) => item.key), ["low-level"]);
assert.deepEqual(currentConditions({ nivel_percent: 0, nivel_valido: false, alerta: "FALHA_SENSOR_NIVEL" }, "online").map((item) => item.key), ["sensor-level"], "falha do sensor não pode virar alerta de reservatório vazio");
assert.deepEqual(currentConditions(null, "waiting"), []);
const first = reconcileConditions([], [], currentConditions({ nivel_percent: 12, nivel_valido: true }, "online"), 1000);
const stillActive = reconcileConditions(first.active, first.resolved, currentConditions({ nivel_percent: 10, nivel_valido: true }, "online"), 2000);
assert.equal(stillActive.active[0].since, 1000);
const recovered = reconcileConditions(stillActive.active, stillActive.resolved, currentConditions({ nivel_percent: 42, nivel_valido: true }, "online"), 3000);
assert.equal(recovered.active.length, 0);
assert.equal(recovered.resolved[0].resolvedAt, 3000);
console.log("Classificação e resolução de alertas verificadas.");
