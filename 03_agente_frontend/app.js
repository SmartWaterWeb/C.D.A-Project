import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, onValue, update, set, get, query, orderByKey, startAt, endAt, limitToLast } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";
import { HISTORY_INTERVAL_MS, parseHistory, summarizeHistory, buildChartPath, buildObservedEvents, levelTrend, createReportCsv } from "./history.js";
import { currentConditions, reconcileConditions } from "./operations.js";

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD9j3ZgzVj4JDSMOo5j73vv1lDhQpitpSM",
  databaseURL: "https://projeto-caixa-d-agua-50902-default-rtdb.firebaseio.com/"
};

const FIREBASE_CONFIG_STORAGE_KEY = "smartwaterweb_firebase_config";

// Mantém configurações já salvas pela versão anterior.
function getActiveFirebaseConfig() {
  const saved = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY)
    || localStorage.getItem("aquapulse_firebase_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.apiKey && parsed.databaseURL) {
        localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) {
      console.warn("Erro ao ler credenciais do localStorage, usando padrões:", e);
    }
  }
  return DEFAULT_FIREBASE_CONFIG;
}

// 2. CAPTURA DE ID DO CONDOMÍNIO (URL PARAMS OU PADRÃO COMERCIAL)
const urlParams = new URLSearchParams(window.location.search);
const DEFAULT_COMMERCIAL_CONDO_ID = "condominio_alpha";
let currentCondoId = urlParams.get("id");
const LAST_CONDO_STORAGE_KEY = "smartwaterweb_last_condo_id";
const runningStandalone = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;
if (!currentCondoId) {
  const lastCondoId = localStorage.getItem(LAST_CONDO_STORAGE_KEY);
  if (lastCondoId && /^[a-zA-Z0-9_-]{3,64}$/.test(lastCondoId)) {
    currentCondoId = lastCondoId;
  } else {
    currentCondoId = DEFAULT_COMMERCIAL_CONDO_ID;
  }
}
if (currentCondoId && /^[a-zA-Z0-9_-]{3,64}$/.test(currentCondoId)) {
  localStorage.setItem(LAST_CONDO_STORAGE_KEY, currentCondoId);
}

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  const button = document.getElementById("install-app-btn");
  if (button) button.hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  const button = document.getElementById("install-app-btn");
  if (button) button.hidden = true;
});

// Elementos DOM
const dom = {
  condoTitle: document.getElementById("condo-title"),
  condoBadge: document.getElementById("condo-badge-id"),
  statusPill: document.getElementById("connection-status-pill"),
  statusText: document.getElementById("connection-status-text"),
  installBtn: document.getElementById("install-app-btn"),
  waterFill: document.getElementById("water-fill"),
  reservoirCard: document.getElementById("reservoir-card"),
  levelKicker: document.getElementById("level-kicker"),
  pumpKicker: document.getElementById("pump-kicker"),
  readingModeLabel: document.getElementById("reading-mode-label"),
  tankStaleLabel: document.getElementById("tank-stale-label"),
  waterPercent: document.getElementById("water-percent"),
  waterVolume: document.getElementById("water-volume"),
  waterCapacity: document.getElementById("water-capacity"),
  tankRulerMarks: document.querySelectorAll(".ruler-mark"),
  pumpCard: document.getElementById("pump-status-card"),
  pumpStateText: document.getElementById("pump-state-text"),
  pumpStateDesc: document.getElementById("pump-state-desc"),
  metricVoltage: document.getElementById("metric-voltage"),
  metricCurrent: document.getElementById("metric-current"),
  metricPower: document.getElementById("metric-power"),
  diagWifi: document.getElementById("diag-wifi"),
  diagUptime: document.getElementById("diag-uptime"),
  diagHeartbeat: document.getElementById("diag-heartbeat"),
  alertBanner: document.getElementById("alert-banner"),
  alertMessage: document.getElementById("alert-message"),
  activeAlertCount: document.getElementById("active-alert-count"),
  alertCenterEmpty: document.getElementById("alert-center-empty"),
  activeAlertList: document.getElementById("active-alert-list"),
  resolvedAlerts: document.getElementById("resolved-alerts"),
  resolvedAlertList: document.getElementById("resolved-alert-list"),
  connectivityBanner: document.getElementById("connectivity-banner"),
  connectivityTitle: document.getElementById("connectivity-title"),
  connectivityMessage: document.getElementById("connectivity-message"),
  demoBtn: document.getElementById("demo-mode-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  switchCondoBtn: document.getElementById("switch-condo-btn"),
  portalModal: document.getElementById("portal-modal"),
  settingsModal: document.getElementById("settings-modal"),
  customIdInput: document.getElementById("custom-condo-input"),
  btnLoadCustomId: document.getElementById("btn-load-custom-id"),
  saveSettingsBtn: document.getElementById("btn-save-settings"),
  inputApiKey: document.getElementById("input-api-key"),
  inputDbUrl: document.getElementById("input-db-url"),
  bubblesContainer: document.getElementById("bubbles-container"),
  diagModal: document.getElementById("diag-modal"),
  closeDiagModal: document.getElementById("close-diag-modal"),
  diagCloudStatus: document.getElementById("diag-cloud-status"),
  diagLastSeen: document.getElementById("diag-last-seen"),
  diagWifiRssi: document.getElementById("diag-wifi-rssi"),
  diagWifiQuality: document.getElementById("diag-wifi-quality"),
  diagSensorHealth: document.getElementById("diag-sensor-health"),
  diagSensorDetail: document.getElementById("diag-sensor-detail"),
  diagPumpHealth: document.getElementById("diag-pump-health"),
  diagPumpPower: document.getElementById("diag-pump-power"),
  diagTelegramStatus: document.getElementById("diag-telegram-status"),
  diagTelegramSent: document.getElementById("diag-telegram-sent"),
  diagUptimeDisplay: document.getElementById("diag-uptime-display"),
  btnTriggerTestAlert: document.getElementById("btn-trigger-test-alert"),
  diagTestFeedback: document.getElementById("diag-test-feedback"),
  tabOverview: document.getElementById("tab-overview"),
  tabAlerts: document.getElementById("tab-alerts"),
  tabHistory: document.getElementById("tab-history"),
  tabAdmin: document.getElementById("tab-admin"),
  viewOverview: document.getElementById("view-overview"),
  viewAlerts: document.getElementById("view-alerts"),
  viewHistory: document.getElementById("view-history"),
  viewAdmin: document.getElementById("view-admin"),
  adminRoleBadge: document.getElementById("admin-role-badge"),
  adminCurrentUid: document.getElementById("admin-current-uid"),
  adminCurrentPermission: document.getElementById("admin-current-permission"),
  btnCopyAdminUid: document.getElementById("btn-copy-admin-uid"),
  adminCondoList: document.getElementById("admin-condo-list"),
  provCondoId: document.getElementById("prov-condo-id"),
  provCondoName: document.getElementById("prov-condo-name"),
  provCapacity: document.getElementById("prov-capacity"),
  provHeight: document.getElementById("prov-height"),
  provSensorTop: document.getElementById("prov-sensor-top"),
  provSindicoEmail: document.getElementById("prov-sindico-email"),
  provSindicoPass: document.getElementById("prov-sindico-pass"),
  provMoradorEmail: document.getElementById("prov-morador-email"),
  provMoradorPass: document.getElementById("prov-morador-pass"),
  provWifiSsid: document.getElementById("prov-wifi-ssid"),
  provWifiPass: document.getElementById("prov-wifi-pass"),
  provEspEmail: document.getElementById("prov-esp-email"),
  provEspPass: document.getElementById("prov-esp-pass"),
  provTgToken: document.getElementById("prov-tg-token"),
  provTgChat: document.getElementById("prov-tg-chat"),
  provFeedback: document.getElementById("prov-feedback"),
  btnProvisionCondo: document.getElementById("btn-provision-condo"),
  provResultsBox: document.getElementById("prov-results-box"),
  provClientText: document.getElementById("prov-client-text"),
  provSecretsText: document.getElementById("prov-secrets-text"),
  btnCopyClientKit: document.getElementById("btn-copy-client-kit"),
  btnDownloadClientKit: document.getElementById("btn-download-client-kit"),
  btnCopySecrets: document.getElementById("btn-copy-secrets"),
  btnDownloadSecrets: document.getElementById("btn-download-secrets"),
  loginModal: document.getElementById("login-modal"),
  loginMessage: document.getElementById("login-message"),
  loginEmail: document.getElementById("login-email"),
  loginPassword: document.getElementById("login-password"),
  loginBtn: document.getElementById("btn-login"),
  logoutBtn: document.getElementById("logout-btn"),
  tankConfigBtn: document.getElementById("tank-config-btn"),
  btnOpenTankConfig: document.getElementById("btn-open-tank-config"),
  tankConfigModal: document.getElementById("tank-config-modal"),
  closeTankConfigModal: document.getElementById("close-tank-config-modal"),
  btnCancelTankConfig: document.getElementById("btn-cancel-tank-config"),
  btnSaveTankConfig: document.getElementById("btn-save-tank-config"),
  inputTankCapacity: document.getElementById("input-tank-capacity"),
  inputTankHeight: document.getElementById("input-tank-height"),
  inputSensorTop: document.getElementById("input-sensor-top"),
  tankConfigFeedback: document.getElementById("tank-config-feedback"),
  historyStatus: document.getElementById("history-status"),
  historyLevelLine: document.getElementById("history-level-line"),
  historyFacts: document.getElementById("history-facts"),
  historyAverage: document.getElementById("history-average"),
  historyMinimum: document.getElementById("history-minimum"),
  historyMaximum: document.getElementById("history-maximum"),
  insightTrend: document.getElementById("insight-trend"),
  insightTrendDetail: document.getElementById("insight-trend-detail"),
  insightPumpHours: document.getElementById("insight-pump-hours"),
  insightPumpStarts: document.getElementById("insight-pump-starts"),
  observedEventList: document.getElementById("observed-event-list"),
  observedEventEmpty: document.getElementById("observed-event-empty"),
  reportPeriod: document.getElementById("report-period"),
  generateReportBtn: document.getElementById("generate-report-btn"),
  reportResult: document.getElementById("report-result"),
  reportTitle: document.getElementById("report-title"),
  reportPeriodLabel: document.getElementById("report-period-label"),
  reportCoverage: document.getElementById("report-coverage"),
  reportAverage: document.getElementById("report-average"),
  reportRange: document.getElementById("report-range"),
  reportPumpHours: document.getElementById("report-pump-hours"),
  reportPumpStarts: document.getElementById("report-pump-starts"),
  reportAlerts: document.getElementById("report-alerts"),
  reportEventList: document.getElementById("report-event-list"),
  reportEventEmpty: document.getElementById("report-event-empty"),
  downloadReportBtn: document.getElementById("download-report-btn"),
  printReportBtn: document.getElementById("print-report-btn")
};

// Variáveis de Estado
let isDemoMode = false;
let demoInterval = null;
let lastHeartbeatTime = null;
let lastUptimeSeconds = null;
let telemetryReceived = false;
let firebaseTransportConnected = null;
let firebaseReadError = null;
let currentConnectivityMode = null;
let heartbeatCheckInterval = null;
let firebaseDb = null;
let currentDbRef = null;
let currentConfigRef = null;
let firebaseAuth = null;
let currentUnsubscribe = null;
let configUnsubscribe = null;
let connectionUnsubscribe = null;
let historyUnsubscribe = null;
let currentReport = null;
let authUnsubscribe = null;
let activeFirebaseApp = null;
let lastAlertKey = null;
let latestTelemetryData = null;
let activeConditions = [];
let resolvedConditions = [];
let observedTodayEvents = [];
let loadedDailyKey = "";
let alertCenterSignature = "";

function getTodayDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getStartOfTodayMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

function getDailyAlertsStorageKey() {
  return `smartwater_daily_alerts_${currentCondoId || "default"}_${getTodayDateKey()}`;
}

function syncDailyAlertsStorage() {
  const storageKey = getDailyAlertsStorageKey();
  const startOfToday = getStartOfTodayMs();
  if (loadedDailyKey !== storageKey) {
    loadedDailyKey = storageKey;
    try {
      // Remove chaves de dias anteriores para não acumular lixo no navegador
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("smartwater_daily_alerts_") && k !== storageKey) {
          localStorage.removeItem(k);
        }
      }
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) {
        resolvedConditions = saved.filter((item) => (item.resolvedAt ?? item.since ?? item.timestamp ?? 0) >= startOfToday);
      } else {
        resolvedConditions = [];
      }
    } catch (_) {
      resolvedConditions = [];
    }
  } else {
    resolvedConditions = resolvedConditions.filter((item) => (item.resolvedAt ?? item.since ?? item.timestamp ?? 0) >= startOfToday);
  }
}

function saveDailyAlertsStorage() {
  try {
    localStorage.setItem(getDailyAlertsStorageKey(), JSON.stringify(resolvedConditions.slice(0, 20)));
  } catch (_) {}
}

function formatEventTime(timestamp) {
  return new Date(timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderEventRows(container, events, limit = 12) {
  if (!container) return;
  const rows = events.slice(0, limit).map((event) => {
    const row = document.createElement("article");
    row.className = `operations-item operations-item--${event.severity}`;
    const heading = document.createElement("div");
    heading.className = "operations-item-head";
    const title = document.createElement("strong");
    title.textContent = event.title;
    const time = document.createElement("time");
    const timestamp = event.resolvedAt ?? event.since ?? event.timestamp;
    time.dateTime = new Date(timestamp).toISOString();
    time.textContent = formatEventTime(timestamp);
    heading.append(title, time);
    const detail = document.createElement("p");
    detail.textContent = event.detail;
    row.append(heading, detail);
    return row;
  });
  container.replaceChildren(...rows);
}

function refreshAlertCenter() {
  syncDailyAlertsStorage();
  const conditions = currentConditions(isDemoMode ? null : latestTelemetryData, currentConnectivityMode);
  const prevLen = resolvedConditions.length;
  ({ active: activeConditions, resolved: resolvedConditions } = reconcileConditions(activeConditions, resolvedConditions, conditions, Date.now(), 20));
  if (resolvedConditions.length !== prevLen) {
    saveDailyAlertsStorage();
  }

  // Combina avisos resolvidos no dia + eventos registrados pelo ESP32 hoje no Firebase (mesmo com site fechado)
  const combinedDailyHistory = [...resolvedConditions];
  for (const obs of observedTodayEvents) {
    const obsTime = obs.timestamp ?? obs.since ?? 0;
    const duplicate = combinedDailyHistory.some(
      (item) => item.title === obs.title && Math.abs((item.resolvedAt ?? item.since ?? item.timestamp ?? 0) - obsTime) < 15 * 60 * 1000
    );
    if (!duplicate) combinedDailyHistory.push(obs);
  }
  combinedDailyHistory.sort((a, b) => (b.resolvedAt ?? b.since ?? b.timestamp ?? 0) - (a.resolvedAt ?? a.since ?? a.timestamp ?? 0));

  const signature = JSON.stringify([currentConnectivityMode, activeConditions, combinedDailyHistory]);
  if (signature === alertCenterSignature) return;
  alertCenterSignature = signature;
  if (dom.activeAlertCount) dom.activeAlertCount.textContent = `${activeConditions.length} ${activeConditions.length === 1 ? "ATIVO" : "ATIVOS"}`;
  if (dom.alertCenterEmpty) {
    dom.alertCenterEmpty.hidden = activeConditions.length > 0;
    dom.alertCenterEmpty.textContent = isDemoMode
      ? "Modo demonstração: os avisos reais ficam disponíveis ao conectar ao condomínio."
      : currentConnectivityMode === "online"
        ? "Nenhum alerta ativo no momento. O histórico diário (00h–24h) aparece logo abaixo."
        : "Aguardando uma leitura atual para avaliar os alertas em tempo real.";
  }
  renderEventRows(dom.activeAlertList, activeConditions);
  if (dom.resolvedAlerts) dom.resolvedAlerts.hidden = combinedDailyHistory.length === 0;
  renderEventRows(dom.resolvedAlertList, combinedDailyHistory, 15);
}

let currentTankConfig = {
  capacidade_litros: 10000,
  altura_total_cm: 200,
  distancia_sensor_topo: 20
};

// 3. EFEITOS SONOROS COM WEB AUDIO API (Sintetizador sem necessidade de mp3)
let audioCtx = null;
function playAlertBeep(freq = 660, duration = 0.25) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.debug("Áudio desativado ou bloqueado pelo navegador.");
  }
}

// 4. ATUALIZAÇÃO VISUAL DA INTERFACE
function updateDashboardUI(data) {
  if (!data) return;
  latestTelemetryData = data;

  // 1. Título e Identificação
  const nomeCondominio = data.nome || `Condomínio ${data.condominio_id || currentCondoId}`;
  if (dom.condoTitle) dom.condoTitle.textContent = nomeCondominio;
  if (dom.condoBadge) dom.condoBadge.textContent = data.condominio_id || currentCondoId || "DESCONHECIDO";

  // 2. Nível e Volume
  const isSensorFault = data.alerta === "FALHA_SENSOR_NIVEL" || data.nivel_valido === false;
  const percent = Math.min(Math.max(parseFloat(data.nivel_percent || 0), 0), 100);
  const capacidade = parseFloat(data.capacidade_total || 10000);
  const volume = parseFloat(data.volume_litros || (percent / 100 * capacidade));

  if (isSensorFault) {
    if (dom.waterFill) {
      dom.waterFill.style.height = "0%";
      dom.waterFill.style.opacity = "0";
    }
    if (dom.waterPercent) dom.waterPercent.textContent = "--%";
    if (dom.waterVolume) dom.waterVolume.textContent = "Sem leitura válida";
    dom.tankRulerMarks.forEach((mark) => mark.classList.remove("active"));
  } else {
    if (dom.waterFill) {
      dom.waterFill.style.opacity = "1";
      dom.waterFill.style.height = `${percent}%`;
    }
    if (dom.waterPercent) dom.waterPercent.textContent = `${percent.toFixed(1)}%`;
    if (dom.waterVolume) dom.waterVolume.textContent = `${Math.round(volume).toLocaleString("pt-BR")} L`;

    // Atualiza marcas ativas na régua graduada
    dom.tankRulerMarks.forEach((mark) => {
      const val = parseInt(mark.getAttribute("data-val") || "0", 10);
      if (percent >= val) {
        mark.classList.add("active");
      } else {
        mark.classList.remove("active");
      }
    });
  }

  if (dom.waterCapacity) dom.waterCapacity.textContent = `${Math.round(capacidade).toLocaleString("pt-BR")} L`;
  updateDiagnosticsUI(data);

  // 3. Status da Bomba
  const isPumpActive = Boolean(data.bomba_ligada);
  if (dom.pumpCard) {
    if (isPumpActive) {
      dom.pumpCard.classList.add("active");
      dom.pumpCard.classList.remove("offline-pump");
      dom.pumpStateText.textContent = "BOMBA ATIVA";
      dom.pumpStateText.className = "pump-state-headline active";
      dom.pumpStateDesc.textContent = "Bomba informada como ligada pelo controlador";
    } else {
      dom.pumpCard.classList.remove("active");
      dom.pumpCard.classList.add("offline-pump");
      dom.pumpStateText.textContent = "BOMBA EM ESPERA";
      dom.pumpStateText.className = "pump-state-headline inactive";
      dom.pumpStateDesc.textContent = "Motor desligado no momento pelo automático ou comando";
    }
  }

  // 4. Métricas Elétricas
  const tensao = data.tensao_v || 220;
  const corrente = parseFloat(data.corrente_a || 0);
  const potencia = parseFloat(data.potencia_w || (isPumpActive ? tensao * corrente : 0));

  if (dom.metricVoltage) dom.metricVoltage.textContent = `${tensao} V`;
  if (dom.metricCurrent) dom.metricCurrent.textContent = `${corrente.toFixed(1)} A`;
  if (dom.metricPower) dom.metricPower.textContent = `${Math.round(potencia)} W`;

  // 5. Diagnóstico e Heartbeat
  const rssi = data.rssi_wifi || -65;
  const uptime = data.uptime_segundos || 0;
  if (dom.diagWifi) dom.diagWifi.textContent = `${rssi} dBm (${rssi > -70 ? "Excelente" : "Regular"})`;
  if (dom.diagUptime) dom.diagUptime.textContent = formatUptime(uptime);

  if (!isDemoMode) {
  if (!isDemoMode) {
    const timestampMs = Number(data.timestamp_ms || data.timestamp || 0);
    const timestampIsValid = Number.isFinite(timestampMs) && timestampMs > 0 && Math.abs(Date.now() - timestampMs) < 60000;
    const uptime = Number(data.uptime_segundos);
    if (timestampIsValid) {
      lastHeartbeatTime = timestampMs;
    } else if (Number.isFinite(uptime) && uptime > 0 && (lastUptimeSeconds === null || uptime !== lastUptimeSeconds)) {
      // Se o uptime avançou ou é a primeira leitura com valor, valida a recepção viva
      lastHeartbeatTime = Date.now();
    }
    lastUptimeSeconds = Number.isFinite(uptime) ? uptime : null;
    telemetryReceived = true;
    firebaseReadError = null;
  }

  // 6. Alertas Inteligentes
  handleAlerts(percent, data.alerta, isPumpActive);
  refreshAlertCenter();
}

// Formata segundos de uptime em texto legível
// Emissor de alerta sonoro Web Audio API para diagnóstico e validação
function playAlertChime(freq = 750, duration = 0.32) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(freq, now);
    osc1.frequency.setValueAtTime(freq * 1.32, now + duration * 0.5);

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(freq * 1.5, now);

    gain.gain.setValueAtTime(0.20, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  } catch (err) {
    console.warn("[Audio] Falha ao reproduzir alerta sonoro:", err);
  }
}

function updateDiagnosticsUI(data) {
  if (!dom.diagModal) return;
  const ageSec = lastHeartbeatTime === null ? null : Math.round((Date.now() - lastHeartbeatTime) / 1000);
  const isLive = currentConnectivityMode === "online" || (data && ageSec !== null && ageSec <= 18);
  if (!data) {
    if (dom.diagCloudStatus) {
      dom.diagCloudStatus.textContent = isLive ? "Online (Aguardando)" : "Desconectado";
      dom.diagCloudStatus.style.color = isLive ? "#6ee7b7" : "#fca5a5";
    }
    return;
  }
  if (dom.diagCloudStatus) {
    dom.diagCloudStatus.textContent = isLive ? "Online / Operacional" : "Desconectado";
    dom.diagCloudStatus.style.color = isLive ? "#6ee7b7" : "#fca5a5";
  }
  if (dom.diagLastSeen) {
    const seg = Math.round((Date.now() - (lastHeartbeatTime || Date.now())) / 1000);
    dom.diagLastSeen.textContent = `Último pacote: há ${Math.max(seg, 0)} s`;
  }
  if (dom.diagWifiRssi) {
    const rssi = typeof data.rssi_wifi === "number" ? data.rssi_wifi : null;
    if (rssi !== null && rssi > -120) {
      dom.diagWifiRssi.textContent = `${rssi} dBm`;
      if (dom.diagWifiQuality) {
        if (rssi >= -65) dom.diagWifiQuality.textContent = "Excelente (Sinal forte no barrilete)";
        else if (rssi >= -75) dom.diagWifiQuality.textContent = "Bom (Operação estável)";
        else if (rssi >= -85) dom.diagWifiQuality.textContent = "Atenção (Sinal fraco, risco de oscilação)";
        else dom.diagWifiQuality.textContent = "Crítico (Considere repetidor Wi-Fi)";
      }
    } else {
      dom.diagWifiRssi.textContent = "Sem leitura";
      if (dom.diagWifiQuality) dom.diagWifiQuality.textContent = "Verifique antena do ESP32";
    }
  }
  if (dom.diagSensorHealth) {
    const valid = data.nivel_valido !== false && data.alerta !== "FALHA_SENSOR_NIVEL";
    dom.diagSensorHealth.textContent = valid ? "Saudável (Eco Ativo)" : "Falha / Sem Eco";
    dom.diagSensorHealth.style.color = valid ? "#6ee7b7" : "#fca5a5";
    if (dom.diagSensorDetail) {
      dom.diagSensorDetail.textContent = valid ? `Nível medido: ${Number(data.nivel_percent || 0).toFixed(1)}%` : "Confira alinhamento e cabos";
    }
  }
  if (dom.diagPumpHealth) {
    const isOn = Boolean(data.bomba_ligada);
    dom.diagPumpHealth.textContent = isOn ? "Bomba em Funcionamento" : "Bomba Desligada";
    dom.diagPumpHealth.style.color = isOn ? "#93c5fd" : "#cbd5e1";
    if (dom.diagPumpPower) {
      const tensao = data.tensao_v || 220;
      const corrente = Number(data.corrente_a || 0).toFixed(2);
      const pot = Math.round(data.potencia_w || (isOn ? tensao * corrente : 0));
      dom.diagPumpPower.textContent = `${tensao}V · ${corrente}A · ${pot}W`;
    }
  }
  if (dom.diagTelegramStatus) {
    const tgOk = Boolean(data.telegram_conectado || data.telegram_configurado);
    dom.diagTelegramStatus.textContent = tgOk ? "Bot Operacional" : "Não configurado";
    if (dom.diagTelegramSent) {
      const sent = data.telegram_mensagens_enviadas ?? 0;
      dom.diagTelegramSent.textContent = `${sent} notificações enviadas`;
    }
  }
  if (dom.diagUptimeDisplay) {
    const upt = data.uptime_segundos;
    if (typeof upt === "number") {
      const h = Math.floor(upt / 3600);
      const m = Math.floor((upt % 3600) / 60);
      const s = upt % 60;
      dom.diagUptimeDisplay.textContent = h > 0 ? `${h}h ${m}min` : `${m}min ${s}s`;
    } else {
      dom.diagUptimeDisplay.textContent = "—";
    }
  }
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

// Alertas de Nível e Bomba
function handleAlerts(percent, alertaBackend, isPumpActive) {
  if (!dom.alertBanner) return;

  let alertKey = "OK";

  if (alertaBackend === "FALHA_SENSOR_NIVEL") {
    alertKey = "FALHA_SENSOR_NIVEL";
    dom.alertBanner.className = "alert-banner critical";
    dom.alertMessage.textContent = "Alerta Crítico: não foi possível medir o nível do reservatório. Verifique o sensor.";
  } else if (alertaBackend === "SOBRECARGA_BOMBA") {
    alertKey = "SOBRECARGA_BOMBA";
    dom.alertBanner.className = "alert-banner critical";
    dom.alertMessage.textContent = "Alerta Crítico: corrente anormal detectada na bomba! Verifique possíveis travamentos.";
  } else if (percent <= 20.0 || alertaBackend === "NIVEL_CRITICO_BAIXO") {
    alertKey = "NIVEL_CRITICO_BAIXO";
    dom.alertBanner.className = "alert-banner critical";
    dom.alertMessage.textContent = `Atenção: Nível crítico de água (${percent.toFixed(1)}%). Risco de desabastecimento iminente!`;
  } else if (percent >= 95.0 || alertaBackend === "RISCO_TRANSBORDAMENTO") {
    alertKey = "RISCO_TRANSBORDAMENTO";
    dom.alertBanner.className = "alert-banner warning";
    dom.alertMessage.textContent = `Alerta: Reservatório em capacidade máxima (${percent.toFixed(1)}%). Verifique o desligamento da bomba.`;
  } else if (isDemoMode) {
    dom.alertBanner.className = "alert-banner info";
    dom.alertMessage.textContent = "Modo de demonstração: estes dados são simulados, não vêm do ESP32.";
  } else {
    dom.alertBanner.className = "alert-banner";
  }

  if (alertKey !== "OK" && alertKey !== lastAlertKey && (isDemoMode || currentConnectivityMode === "online")) {
    playAlertBeep(alertKey === "SOBRECARGA_BOMBA" ? 880 : 750, 0.4);
  }
  lastAlertKey = alertKey;
  dom.alertBanner.classList.toggle("alert-banner--stale", !isDemoMode && currentConnectivityMode !== "online");
}

// Status de Conexão com ESP32
const HEARTBEAT_TIMEOUT_MS = 18000;

function renderConnectivity() {
  const ageMs = lastHeartbeatTime === null ? null : Date.now() - lastHeartbeatTime;
  let mode = "waiting";
  let title = "";
  let message = "";
  let status = "Aguardando leitura";

  if (isDemoMode) {
    mode = "demo";
    status = "Modo demonstração";
  } else if (!navigator.onLine) {
    mode = "browser-offline";
    title = "Este aparelho está sem internet";
    message = "O painel não recebe novas leituras. Os valores exibidos são os últimos conhecidos; verifique sua conexão.";
    status = "Painel sem internet";
  } else if (!currentCondoId || !firebaseAuth?.currentUser) {
    mode = "access";
    status = "Aguardando acesso";
  } else if (firebaseReadError) {
    mode = "read-error";
    title = "Telemetria indisponível";
    message = "Não foi possível ler os dados deste condomínio. Verifique acesso e conexão.";
    status = "Falha de leitura";
  } else if (firebaseTransportConnected === false) {
    mode = "cloud-offline";
    title = "Sem conexão com o Firebase";
    message = "O painel perdeu contato com o banco de dados. Os valores permanecem como última leitura até a conexão voltar.";
    status = "Firebase desconectado";
  } else if (telemetryReceived && ageMs === null) {
    mode = "verifying";
    title = "Confirmando a leitura do ESP32";
    message = "Os valores recebidos ainda não têm horário confiável. Aguardando um novo envio para confirmar que estão atuais.";
    status = "Confirmando leitura";
  } else if (telemetryReceived && (ageMs > HEARTBEAT_TIMEOUT_MS || ageMs < -10000)) {
    mode = "device-offline";
    title = "ESP32 sem novas leituras";
    message = "O controlador pode estar sem energia ou internet. Nível, bomba e métricas abaixo são a última leitura recebida, não dados ao vivo.";
    status = "ESP32 sem leituras";
  } else if (telemetryReceived) {
    mode = "online";
    status = "ESP32 online";
  }

  const stale = telemetryReceived && mode !== "online" && mode !== "demo";
  document.body.classList.toggle("telemetry-stale", stale);
  dom.reservoirCard?.classList.toggle("is-stale", stale);
  dom.pumpCard?.classList.toggle("is-stale", stale);
  dom.alertBanner?.classList.toggle("alert-banner--stale", stale);
  if (dom.tankStaleLabel) dom.tankStaleLabel.hidden = !stale;
  if (dom.levelKicker) dom.levelKicker.textContent = stale ? "ÚLTIMO NÍVEL CONHECIDO" : "NÍVEL ATUAL";
  if (dom.pumpKicker) dom.pumpKicker.textContent = stale ? "ÚLTIMO ESTADO CONHECIDO" : "OPERAÇÃO ATUAL";
  if (dom.readingModeLabel) dom.readingModeLabel.textContent = stale ? "Pausada · última leitura" : mode === "online" || mode === "demo" ? "Automática" : "Aguardando";
  if (telemetryReceived && dom.pumpStateDesc) {
    const wasOn = dom.pumpCard?.classList.contains("active");
    dom.pumpStateDesc.textContent = stale
      ? `Última leitura: bomba ${wasOn ? "ligada" : "desligada"}. Estado atual não confirmado.`
      : wasOn ? "Bomba informada como ligada pelo controlador" : "Motor desligado no momento pelo automático ou comando";
  }

  if (dom.statusPill) {
    dom.statusPill.classList.toggle("offline", mode !== "online" && mode !== "demo" && mode !== "access" && mode !== "waiting");
    dom.statusPill.classList.toggle("pending", mode === "access" || mode === "waiting" || mode === "verifying");
  }
  if (dom.statusText && dom.statusText.textContent !== status) dom.statusText.textContent = status;

  if (dom.connectivityBanner && mode !== currentConnectivityMode) {
    const showBanner = title !== "";
    dom.connectivityBanner.hidden = !showBanner;
    dom.connectivityBanner.classList.toggle("connectivity-banner--pending", mode === "verifying");
    if (dom.connectivityTitle) dom.connectivityTitle.textContent = title;
    if (dom.connectivityMessage) dom.connectivityMessage.textContent = message;
  }
  currentConnectivityMode = mode;
  refreshAlertCenter();
}

// Monitora falta de novas leituras confirmadas, sem confundir com a rede do navegador.
function startHeartbeatWatchdog() {
  if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
  heartbeatCheckInterval = setInterval(() => {
    if (isDemoMode) {
      if (dom.diagHeartbeat) dom.diagHeartbeat.textContent = "Modo Demo Ativo";
      renderConnectivity();
      return;
    }
    const elapsedSec = lastHeartbeatTime === null ? null : Math.floor((Date.now() - lastHeartbeatTime) / 1000);
    if (dom.diagHeartbeat) dom.diagHeartbeat.textContent = elapsedSec === null
      ? telemetryReceived ? "Aguardando confirmação..." : "Aguardando 1º envio..."
      : elapsedSec < 0 ? "Horário do ESP32 divergente" : `Há ${elapsedSec}s`;
    renderConnectivity();
  }, 1000);
}

// Criação de bolhas dinâmicas flutuantes no tanque
function initTankBubbles() {
  if (!dom.bubblesContainer) return;
  dom.bubblesContainer.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const size = Math.random() * 6 + 3;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.random() * 80 + 10}%`;
    bubble.style.animationDuration = `${Math.random() * 4 + 4}s`;
    bubble.style.animationDelay = `${-Math.random() * 7}s`;
    dom.bubblesContainer.appendChild(bubble);
  }
}

// 5. CONEXÃO COM O FIREBASE REALTIME DATABASE
function isValidCondoId(condoId) {
  return /^[a-z0-9_-]{3,64}$/i.test(condoId);
}

function clearTelemetryPresentation() {
  latestTelemetryData = null;
  activeConditions = [];
  resolvedConditions = [];
  alertCenterSignature = "";
  if (dom.waterFill) {
    dom.waterFill.style.height = "0%";
    dom.waterFill.style.opacity = "0";
  }
  if (dom.waterPercent) dom.waterPercent.textContent = "--%";
  if (dom.waterVolume) dom.waterVolume.textContent = "-- L";
  if (dom.waterCapacity) dom.waterCapacity.textContent = "-- L";
  dom.tankRulerMarks.forEach((mark) => mark.classList.remove("active"));
  if (dom.pumpCard) {
    dom.pumpCard.classList.remove("active");
    dom.pumpCard.classList.add("offline-pump");
  }
  if (dom.pumpStateText) {
    dom.pumpStateText.textContent = "AGUARDANDO LEITURA";
    dom.pumpStateText.className = "pump-state-headline inactive";
  }
  if (dom.pumpStateDesc) dom.pumpStateDesc.textContent = "Estado da bomba ainda não confirmado";
  if (dom.metricVoltage) dom.metricVoltage.textContent = "-- V";
  if (dom.metricCurrent) dom.metricCurrent.textContent = "-- A";
  if (dom.metricPower) dom.metricPower.textContent = "-- W";
  if (dom.diagWifi) dom.diagWifi.textContent = "-- dBm";
  if (dom.diagUptime) dom.diagUptime.textContent = "--";
  if (dom.alertBanner) dom.alertBanner.className = "alert-banner";
  lastAlertKey = null;
  refreshAlertCenter();
}

function clearHistoryPresentation() {
  if (historyUnsubscribe) {
    historyUnsubscribe();
    historyUnsubscribe = null;
  }
  currentReport = null;
  if (dom.historyStatus) dom.historyStatus.textContent = "Aguardando dados históricos.";
  dom.historyLevelLine?.setAttribute("d", "");
  if (dom.historyFacts) dom.historyFacts.hidden = true;
  if (dom.reportResult) dom.reportResult.hidden = true;
  if (dom.insightTrend) dom.insightTrend.textContent = "—";
  if (dom.insightTrendDetail) dom.insightTrendDetail.textContent = "Aguardando amostras";
  if (dom.insightPumpHours) dom.insightPumpHours.textContent = "—";
  if (dom.insightPumpStarts) dom.insightPumpStarts.textContent = "—";
  if (dom.observedEventEmpty) dom.observedEventEmpty.hidden = false;
  dom.observedEventList?.replaceChildren();
  dom.reportEventList?.replaceChildren();
}

function showHistory(samples) {
  const endMs = Date.now();
  const startMs = endMs - 24 * 60 * 60 * 1000;
  const recent = samples.filter((sample) => sample.timestamp >= startMs && sample.timestamp <= endMs);
  const summary = summarizeHistory(recent, startMs, endMs);
  if (dom.historyStatus) dom.historyStatus.textContent = recent.length
    ? `${recent.length} amostras nas últimas 24 horas · cobertura aproximada de ${summary.coverage}%.`
    : "Ainda não há amostras nas últimas 24 horas. A leitura ao vivo continua disponível.";
  dom.historyLevelLine?.setAttribute("d", buildChartPath(recent, startMs, endMs));
  if (dom.historyFacts) dom.historyFacts.hidden = !recent.length;
  if (dom.historyAverage) dom.historyAverage.textContent = summary.average === null ? "—" : `${summary.average.toFixed(1)}%`;
  if (dom.historyMinimum) dom.historyMinimum.textContent = summary.minimum === null ? "—" : `${summary.minimum.toFixed(1)}%`;
  if (dom.historyMaximum) dom.historyMaximum.textContent = summary.maximum === null ? "—" : `${summary.maximum.toFixed(1)}%`;
  const trend = levelTrend(recent, endMs);
  if (dom.insightTrend) dom.insightTrend.textContent = trend.direction === "rising" ? "Subindo" : trend.direction === "falling" ? "Caindo" : trend.direction === "stable" ? "Estável" : "Sem dados";
  if (dom.insightTrendDetail) dom.insightTrendDetail.textContent = trend.change === null ? "Aguardando sequência recente" : `${trend.change >= 0 ? "+" : ""}${trend.change.toFixed(1)} ponto(s) em até 2 h`;
  if (dom.insightPumpHours) dom.insightPumpHours.textContent = recent.length ? `${summary.estimatedPumpHours.toFixed(1)} h` : "—";
  if (dom.insightPumpStarts) dom.insightPumpStarts.textContent = recent.length ? String(summary.pumpStartsObserved) : "—";
  const events = buildObservedEvents(recent, startMs, endMs);
  renderEventRows(dom.observedEventList, events);
  if (dom.observedEventEmpty) dom.observedEventEmpty.hidden = events.length > 0;

  // Alimenta a Central de Alertas com os eventos observados pelo ESP32 no dia de hoje (a partir das 00h)
  const startOfToday = getStartOfTodayMs();
  const todaySamples = recent.filter((sample) => sample.timestamp >= startOfToday);
  observedTodayEvents = buildObservedEvents(todaySamples, startOfToday, endMs);
  refreshAlertCenter();
}

function connectHistory(condoId) {
  const historyRef = ref(firebaseDb, `condominios/${condoId}/historico/amostras`);
  const recentQuery = query(historyRef, orderByKey(), limitToLast(100));
  historyUnsubscribe = onValue(recentQuery, (snapshot) => {
    const now = Date.now();
    showHistory(parseHistory(snapshot.val(), now - 24 * 60 * 60 * 1000, now));
  }, (error) => {
    console.warn("[Historico] Leitura indisponível:", error);
    if (dom.historyStatus) dom.historyStatus.textContent = "Histórico indisponível no momento. A telemetria em tempo real não foi afetada.";
  });
}

async function generateReport() {
  if (!firebaseDb || !firebaseAuth?.currentUser || !currentCondoId || !isValidCondoId(currentCondoId) || isDemoMode) {
    if (dom.historyStatus) dom.historyStatus.textContent = "Entre em um condomínio com dados reais para gerar o relatório.";
    return;
  }
  if (!navigator.onLine || firebaseTransportConnected === false) {
    if (dom.historyStatus) dom.historyStatus.textContent = "Conecte-se à internet e ao Firebase para gerar um relatório atualizado.";
    return;
  }
  const condoId = currentCondoId;
  const userId = firebaseAuth.currentUser.uid;
  const days = Number(dom.reportPeriod?.value);
  if (![7, 30, 90].includes(days)) return;
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 60 * 60 * 1000;
  if (dom.generateReportBtn) {
    dom.generateReportBtn.disabled = true;
    dom.generateReportBtn.textContent = "Gerando...";
  }
  if (dom.reportResult) dom.reportResult.hidden = true;
  currentReport = null;
  try {
    const historyRef = ref(firebaseDb, `condominios/${condoId}/historico/amostras`);
    const periodQuery = query(historyRef, orderByKey(),
      startAt(String(Math.floor(startMs / HISTORY_INTERVAL_MS))),
      endAt(String(Math.floor(endMs / HISTORY_INTERVAL_MS))));
    const snapshot = await get(periodQuery);
    if (condoId !== currentCondoId || firebaseAuth?.currentUser?.uid !== userId) return;
    const samples = parseHistory(snapshot.val(), startMs, endMs);
    if (!samples.length) {
      if (dom.historyStatus) dom.historyStatus.textContent = "Sem amostras neste período. O histórico começa após instalar o firmware e publicar as regras atualizadas.";
      return;
    }
    const summary = summarizeHistory(samples, startMs, endMs);
    const label = `Últimos ${days} dias`;
    currentReport = { condoId, label, samples, summary, startMs, endMs };
    if (dom.reportTitle) dom.reportTitle.textContent = `Relatório · ${condoId}`;
    if (dom.reportPeriodLabel) dom.reportPeriodLabel.textContent = `${label} · ${new Date(startMs).toLocaleString("pt-BR")} a ${new Date(endMs).toLocaleString("pt-BR")}`;
    if (dom.reportCoverage) dom.reportCoverage.textContent = `${summary.coverage}% (${summary.count} amostras)`;
    if (dom.reportAverage) dom.reportAverage.textContent = summary.average === null ? "—" : `${summary.average.toFixed(1)}%`;
    if (dom.reportRange) dom.reportRange.textContent = summary.minimum === null ? "—" : `${summary.minimum.toFixed(1)}% / ${summary.maximum.toFixed(1)}%`;
    if (dom.reportPumpHours) dom.reportPumpHours.textContent = `${summary.estimatedPumpHours.toFixed(1)} h`;
    if (dom.reportPumpStarts) dom.reportPumpStarts.textContent = String(summary.pumpStartsObserved);
    if (dom.reportAlerts) dom.reportAlerts.textContent = String(summary.alertTransitionsObserved);
    const events = buildObservedEvents(samples, startMs, endMs);
    renderEventRows(dom.reportEventList, events, 12);
    if (dom.reportEventEmpty) dom.reportEventEmpty.hidden = events.length > 0;
    if (dom.reportResult) dom.reportResult.hidden = false;
  } catch (error) {
    console.warn("[Historico] Falha ao gerar relatório:", error);
    if (dom.historyStatus) dom.historyStatus.textContent = "Não foi possível consultar o histórico. Verifique suas permissões e tente novamente.";
  } finally {
    if (dom.generateReportBtn) {
      dom.generateReportBtn.disabled = false;
      dom.generateReportBtn.textContent = "Gerar relatório";
    }
  }
}

function disconnectFirebaseListener() {
  clearHistoryPresentation();
  if (currentUnsubscribe) {
    currentUnsubscribe();
    currentUnsubscribe = null;
  }
  if (configUnsubscribe) {
    configUnsubscribe();
    configUnsubscribe = null;
  }
  if (connectionUnsubscribe) {
    connectionUnsubscribe();
    connectionUnsubscribe = null;
  }
  currentDbRef = null;
  currentConfigRef = null;
  firebaseTransportConnected = null;
  firebaseReadError = null;
  lastHeartbeatTime = null;
  lastUptimeSeconds = null;
  telemetryReceived = false;
  currentConnectivityMode = null;
  clearTelemetryPresentation();
}

function connectToFirebase(condoId) {
  if (isDemoMode) return;
  if (!isValidCondoId(condoId)) {
    dom.alertBanner.className = "alert-banner warning";
    dom.alertMessage.textContent = "Identificador de condomínio inválido.";
    renderConnectivity();
    return;
  }

  disconnectFirebaseListener();
  renderConnectivity();
  const config = getActiveFirebaseConfig();

  // Verifica se as chaves padrão ainda não foram alteradas
  if (config.apiKey === "SUA_FIREBASE_WEB_API_KEY" || config.databaseURL.includes("seu-projeto")) {
    console.warn("Credenciais do Firebase pendentes de configuração!");
    if (dom.alertBanner) {
      dom.alertBanner.className = "alert-banner warning";
      dom.alertMessage.textContent = "Credenciais do Firebase padrão detectadas. Insira sua Web API Key e Database URL nas Configurações ou teste no Modo Simulação.";
    }
  }

  try {
    if (!activeFirebaseApp) {
      activeFirebaseApp = initializeApp(config);
      firebaseDb = getDatabase(activeFirebaseApp);
      firebaseAuth = getAuth(activeFirebaseApp);
    }

    const cleanId = condoId;
    currentDbRef = ref(firebaseDb, `condominios/${cleanId}/telemetria`);
    currentConfigRef = ref(firebaseDb, `condominios/${cleanId}/config`);
    connectionUnsubscribe = onValue(ref(firebaseDb, ".info/connected"), (snapshot) => {
      firebaseTransportConnected = snapshot.val() === true;
      renderConnectivity();
    });

    console.log(`[Firebase] Ouvindo atualizações autorizadas de: /condominios/${cleanId}/telemetria`);

    // Ouvinte da Configuração Física do Reservatório
    configUnsubscribe = onValue(currentConfigRef, (snapshot) => {
      const cfg = snapshot.val();
      if (cfg) {
        currentTankConfig = {
          capacidade_litros: parseFloat(cfg.capacidade_litros) || 10000,
          altura_total_cm: parseFloat(cfg.altura_total_cm) || 200,
          distancia_sensor_topo: parseFloat(cfg.distancia_sensor_topo) || 20
        };
        if (dom.waterCapacity) {
          dom.waterCapacity.textContent = `${Math.round(currentTankConfig.capacidade_litros).toLocaleString("pt-BR")} L`;
        }
      }
    }, (error) => {
      console.warn("[Firebase] Aviso ao ler /config:", error);
    });

    currentUnsubscribe = onValue(currentDbRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        console.warn(`[Firebase] O condomínio ${cleanId} ainda não possui telemetria.`);
        if (dom.diagHeartbeat) dom.diagHeartbeat.textContent = "Nó vazio no Firebase";
        renderConnectivity();
        return;
      }
      updateDashboardUI(data);
    }, (error) => {
      console.error("[Sistema] Erro ao ler telemetria:", error);
      firebaseReadError = error.code || error.message || "Erro desconhecido";
      if (dom.alertBanner) {
        dom.alertBanner.className = "alert-banner";
      }
      renderConnectivity();
    });
    // O histórico é complementar. Qualquer falha ao iniciar esta consulta não
    // pode impedir os ouvintes de telemetria e configuração acima.
    try {
      connectHistory(cleanId);
    } catch (historyError) {
      console.warn("[Historico] Falha ao iniciar:", historyError);
      if (dom.historyStatus) dom.historyStatus.textContent = "Histórico indisponível; a leitura ao vivo continua ativa.";
    }
  } catch (err) {
    console.error("[Firebase] Falha na inicialização:", err);
    firebaseReadError = err.message || "Falha na inicialização";
    renderConnectivity();
  }
}

function showLogin(message = "Entre com a conta autorizada para este condomínio.") {
  if (dom.loginMessage) dom.loginMessage.textContent = message;
  if (dom.loginModal) dom.loginModal.classList.add("show");
}

let isUniversalAdmin = false;
let userCanCalibrate = true;
let cachedAccessMap = {};

function updateCalibrationVisibility(canCalibrate) {
  userCanCalibrate = canCalibrate;
  const displayVal = canCalibrate ? "" : "none";
  if (dom.tankConfigBtn) dom.tankConfigBtn.style.display = displayVal;
  if (dom.btnOpenTankConfig) dom.btnOpenTankConfig.style.display = displayVal;
}

async function refreshAdminCondoList(allowedCondos = []) {
  if (!dom.adminCondoList) return;
  const condoSet = new Set(allowedCondos);
  if (currentCondoId) condoSet.add(currentCondoId);
  if (firebaseDb && firebaseAuth?.currentUser && isUniversalAdmin) {
    try {
      const condosSnap = await get(ref(firebaseDb, "condominios"));
      const condosObj = condosSnap.val();
      if (condosObj && typeof condosObj === "object") {
        Object.keys(condosObj).forEach((k) => condoSet.add(k));
      }
    } catch (_) {}
  }
  const list = [...condoSet].filter((id) => isValidCondoId(id));
  const buttons = list.map((cid) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `admin-condo-pill${cid === currentCondoId ? " active" : ""}`;
    btn.textContent = cid;
    btn.addEventListener("click", () => {
      currentCondoId = cid;
      localStorage.setItem(LAST_CONDO_STORAGE_KEY, cid);
      if (dom.condoBadge) dom.condoBadge.textContent = cid;
      connectToFirebase(cid);
      refreshAdminCondoList(list);
      switchTab("overview");
    });
    return btn;
  });
  dom.adminCondoList.replaceChildren(...buttons);
}

function applyUserRoleAndPermissions(user, accessMap) {
  cachedAccessMap = accessMap && typeof accessMap === "object" ? accessMap : {};
  if (dom.adminCurrentUid) dom.adminCurrentUid.textContent = user ? user.uid : "—";

  const urlAdmin = urlParams.get("admin") === "1";
  const dbAdmin = cachedAccessMap.admin === true || cachedAccessMap.role === "admin";
  const allowedCondos = Object.keys(cachedAccessMap).filter(
    (cid) => cid !== "admin" && cid !== "role" && cachedAccessMap[cid] && (cachedAccessMap[cid].read === true || cachedAccessMap[cid].write === true)
  );

  isUniversalAdmin = Boolean(urlAdmin || dbAdmin);

  // Controle estrito do HUD Lateral e Abas por Persona
  if (isUniversalAdmin) {
    if (dom.tabAdmin) dom.tabAdmin.hidden = false;
    if (dom.switchCondoBtn) dom.switchCondoBtn.style.display = "";
    if (dom.settingsBtn) dom.settingsBtn.style.display = "";
  } else {
    if (dom.tabAdmin) dom.tabAdmin.hidden = true;
    if (dom.switchCondoBtn) dom.switchCondoBtn.style.display = allowedCondos.length > 1 ? "" : "none";
    if (dom.settingsBtn) dom.settingsBtn.style.display = "none";
    if (dom.viewAdmin && dom.viewAdmin.style.display !== "none") {
      switchTab("overview");
    }
  }

  const condoPerm = cachedAccessMap[currentCondoId];
  const isMorador = !isUniversalAdmin && (
    cachedAccessMap.role === "morador" ||
    (condoPerm && (condoPerm.role === "morador" || condoPerm.calibrate === false))
  );

  if (isUniversalAdmin) {
    updateCalibrationVisibility(true);
    if (dom.adminCurrentPermission) dom.adminCurrentPermission.textContent = "Admin Universal (Acesso Total a Todos os Condomínios)";
    if (dom.adminRoleBadge) dom.adminRoleBadge.textContent = "ADMIN UNIVERSAL";
  } else if (isMorador) {
    // Morador: Somente leitura. Sem botão calibrar no HUD nem no card
    updateCalibrationVisibility(false);
    if (dom.adminCurrentPermission) dom.adminCurrentPermission.textContent = `Morador (${currentCondoId}) · Somente Leitura`;
    if (dom.adminRoleBadge) dom.adminRoleBadge.textContent = "SOMENTE LEITURA";
  } else {
    // Síndico: Apenas leitura e calibração da sua própria caixa
    updateCalibrationVisibility(true);
    if (dom.adminCurrentPermission) dom.adminCurrentPermission.textContent = `Síndico (${currentCondoId}) · Leitura e Calibração`;
    if (dom.adminRoleBadge) dom.adminRoleBadge.textContent = "SÍNDICO";
  }
}

function initializeAuthentication() {
  const config = getActiveFirebaseConfig();
  if (!activeFirebaseApp) {
    activeFirebaseApp = initializeApp(config);
    firebaseDb = getDatabase(activeFirebaseApp);
    firebaseAuth = getAuth(activeFirebaseApp);
  }

  if (authUnsubscribe) authUnsubscribe();
  authUnsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
    if (user) {
      dom.loginModal?.classList.remove("show");
      let accessMap = {};
      try {
        const accessSnap = await get(ref(firebaseDb, `access/${user.uid}`));
        accessMap = accessSnap.val() || {};
        if (accessMap && typeof accessMap === "object") {
          const allowedCondos = Object.keys(accessMap).filter(
            (cid) => cid !== "admin" && cid !== "role" && accessMap[cid] && (accessMap[cid].read === true || accessMap[cid].write === true)
          );
          // Se a conta for de cliente (síndico ou morador), SEMPRE direciona para o condomínio dele
          const isPrivileged = accessMap.admin === true || accessMap.role === "admin";
          if (!isPrivileged && allowedCondos.length >= 1) {
            currentCondoId = allowedCondos[0];
            localStorage.setItem(LAST_CONDO_STORAGE_KEY, currentCondoId);
            if (dom.condoBadge) dom.condoBadge.textContent = currentCondoId;
          } else if (!urlParams.get("id") && allowedCondos.length >= 1 && !allowedCondos.includes(currentCondoId)) {
            currentCondoId = allowedCondos[0];
            localStorage.setItem(LAST_CONDO_STORAGE_KEY, currentCondoId);
            if (dom.condoBadge) dom.condoBadge.textContent = currentCondoId;
          }
        }
      } catch (err) {
        console.warn("[Auth] Permissões dinâmicas não consultadas:", err);
      }
      applyUserRoleAndPermissions(user, accessMap);
      if (currentCondoId) connectToFirebase(currentCondoId);
    } else {
      disconnectFirebaseListener();
      renderConnectivity();
      showLogin("Entre com a conta autorizada para visualizar a telemetria.");
    }
  });
}

// 6. MOTOR DE SIMULAÇÃO (MODO DEMO PARA TESTES IMEDIATOS)
let simLevel = 74.5;
let simPump = false;
let simUptime = 3600;

function toggleDemoMode() {
  isDemoMode = !isDemoMode;

  if (isDemoMode) {
    disconnectFirebaseListener();
    if (dom.historyStatus) dom.historyStatus.textContent = "Modo demonstração: relatórios exigem dados reais do condomínio.";
    renderConnectivity();
    dom.demoBtn.classList.add("demo-active");
    const demoLabel = dom.demoBtn.querySelector("span");
    if (demoLabel) demoLabel.textContent = "Demonstração ativa";
    else dom.demoBtn.textContent = "Demonstração ativa";
    if (dom.alertBanner) {
      dom.alertBanner.className = "alert-banner info";
      dom.alertMessage.textContent = "Modo de Demonstração Ativo: Simulando telemetria fluida em tempo real.";
    }

    demoInterval = setInterval(() => {
      // Simula flutuação de nível
      if (simPump) {
        simLevel += 1.2;
        if (simLevel >= 96.0) {
          simPump = false;
        }
      } else {
        simLevel -= 0.8;
        if (simLevel <= 22.0) {
          simPump = true;
        }
      }

      simUptime += 3;
      const simData = {
        condominio_id: currentCondoId || "condominio_demo",
        nome: `Condomínio ${currentCondoId || "Alpha"} (Modo Demonstração)`,
        nivel_percent: simLevel,
        volume_litros: (simLevel / 100) * 10000,
        capacidade_total: 10000,
        bomba_ligada: simPump,
        tensao_v: 220,
        corrente_a: simPump ? 4.8 : 0.0,
        potencia_w: simPump ? 1056 : 0,
        rssi_wifi: -58,
        uptime_segundos: simUptime,
        alerta: simLevel <= 20 ? "NIVEL_CRITICO_BAIXO" : (simLevel >= 95 ? "RISCO_TRANSBORDAMENTO" : "OK")
      };

      updateDashboardUI(simData);
    }, 2000);

  } else {
    dom.demoBtn.classList.remove("demo-active");
    const demoLabel = dom.demoBtn.querySelector("span");
    if (demoLabel) demoLabel.textContent = "Modo demonstração";
    else dom.demoBtn.textContent = "Modo demonstração";
    clearInterval(demoInterval);
    renderConnectivity();
    if (dom.alertBanner) dom.alertBanner.className = "alert-banner";
    if (currentCondoId) {
      if (firebaseAuth?.currentUser) connectToFirebase(currentCondoId);
      else showLogin();
    }
  }
}

// Sistema de Navegação SPA por Abas / Telas Dedicadas (Sem Scroll Vertical)
function switchTab(targetTab) {
  const views = {
    overview: dom.viewOverview,
    alerts: dom.viewAlerts,
    history: dom.viewHistory,
    admin: dom.viewAdmin
  };
  const tabs = {
    overview: dom.tabOverview,
    alerts: dom.tabAlerts,
    history: dom.tabHistory,
    admin: dom.tabAdmin
  };

  Object.keys(views).forEach((name) => {
    if (views[name]) {
      views[name].style.display = name === targetTab ? "block" : "none";
    }
    if (tabs[name]) {
      const isActive = name === targetTab;
      tabs[name].classList.toggle("active", isActive);
      tabs[name].classList.toggle("workspace-home", isActive);
      if (isActive) {
        tabs[name].setAttribute("aria-selected", "true");
      } else {
        tabs[name].removeAttribute("aria-selected");
      }
    }
  });

  window.scrollTo({ top: 0, behavior: "instant" });
}

// 7. CONTROLE DE MODAIS E NAVEGAÇÃO MULTI-TENANT
function setupModals() {
  dom.generateReportBtn?.addEventListener("click", generateReport);
  dom.printReportBtn?.addEventListener("click", () => {
    if (currentReport) window.print();
  });
  dom.downloadReportBtn?.addEventListener("click", () => {
    if (!currentReport) return;
    const { condoId, label, samples, summary, startMs, endMs } = currentReport;
    const csv = createReportCsv(condoId, label, samples, summary, startMs, endMs);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartwater-${condoId}-${new Date(endMs).toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // Modal de Seleção de Condomínio
  if (dom.switchCondoBtn) {
    dom.switchCondoBtn.addEventListener("click", () => {
      dom.portalModal.classList.add("show");
    });
  }

  // Predefinições do modal
  document.querySelectorAll(".condo-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-id");
      if (targetId) {
        window.location.search = `?id=${targetId}`;
      }
    });
  });

  // Botão carregar ID personalizado
  if (dom.btnLoadCustomId) {
    dom.btnLoadCustomId.addEventListener("click", () => {
      const val = dom.customIdInput.value.trim();
      if (isValidCondoId(val)) {
        window.location.search = `?id=${encodeURIComponent(val)}`;
      } else {
        alert("Use apenas letras, números, hífen ou sublinhado (3 a 64 caracteres). ");
      }
    });
  }

  // Fechar modal ao clicar no botão ✕
  const closePortalBtn = document.getElementById("close-portal-modal");
  if (closePortalBtn) {
    closePortalBtn.addEventListener("click", () => {
      dom.portalModal.classList.remove("show");
    });
  }

  const closeSettingsBtn = document.getElementById("close-settings-modal");
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", () => {
      dom.settingsModal.classList.remove("show");
    });
  }

  // Fechar modal ao clicar fora ou tecla ESC
  window.addEventListener("click", (e) => {
    if (e.target === dom.portalModal && currentCondoId) {
      dom.portalModal.classList.remove("show");
    }
    if (e.target === dom.settingsModal) {
      dom.settingsModal.classList.remove("show");
    }
    if (e.target === dom.tankConfigModal) {
      dom.tankConfigModal.classList.remove("show");
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (dom.portalModal) dom.portalModal.classList.remove("show");
      if (dom.settingsModal) dom.settingsModal.classList.remove("show");
      if (dom.tankConfigModal) dom.tankConfigModal.classList.remove("show");
    }
  });

  // Modal de Configurações
  if (dom.settingsBtn) {
    dom.settingsBtn.addEventListener("click", () => {
      const currentConfig = getActiveFirebaseConfig();
      if (dom.inputApiKey) dom.inputApiKey.value = currentConfig.apiKey;
      if (dom.inputDbUrl) dom.inputDbUrl.value = currentConfig.databaseURL;
      dom.settingsModal.classList.add("show");
    });
  }

  if (dom.saveSettingsBtn) {
    dom.saveSettingsBtn.addEventListener("click", () => {
      const apiKey = dom.inputApiKey.value.trim();
      const databaseURL = dom.inputDbUrl.value.trim();
      if (apiKey && databaseURL) {
        localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify({ apiKey, databaseURL }));
        alert("Configurações salvas com sucesso! A página será recarregada.");
        window.location.reload();
      } else {
        alert("Por favor, preencha todos os campos.");
      }
    });
  }

  // Modal de Calibração da Caixa d'Água
  function openTankConfigModal() {
    if (!userCanCalibrate) {
      return;
    }
    if (!currentCondoId && !isDemoMode) {
      alert("Selecione um condomínio antes de calibrar a caixa.");
      return;
    }

    if (dom.inputTankCapacity) dom.inputTankCapacity.value = currentTankConfig.capacidade_litros;
    if (dom.inputTankHeight) dom.inputTankHeight.value = currentTankConfig.altura_total_cm;
    if (dom.inputSensorTop) dom.inputSensorTop.value = currentTankConfig.distancia_sensor_topo;

    if (dom.tankConfigFeedback) {
      dom.tankConfigFeedback.style.display = "none";
      dom.tankConfigFeedback.textContent = "";
      dom.tankConfigFeedback.className = "config-feedback";
    }

    const modal = dom.tankConfigModal || document.getElementById("tank-config-modal");
    if (modal) {
      modal.classList.add("show");
    }
  }

  if (dom.tankConfigBtn) {
    dom.tankConfigBtn.addEventListener("click", openTankConfigModal);
  }
  if (dom.btnOpenTankConfig) {
    dom.btnOpenTankConfig.addEventListener("click", openTankConfigModal);
  }

  if (dom.closeTankConfigModal) {
    dom.closeTankConfigModal.addEventListener("click", () => {
      dom.tankConfigModal?.classList.remove("show");
    });
  }

  if (dom.btnCancelTankConfig) {
    dom.btnCancelTankConfig.addEventListener("click", () => {
      dom.tankConfigModal?.classList.remove("show");
    });
  }

  if (dom.btnSaveTankConfig) {
    dom.btnSaveTankConfig.addEventListener("click", async () => {
      const capacidade = parseFloat(dom.inputTankCapacity?.value);
      const altura = parseFloat(dom.inputTankHeight?.value);
      const distTopo = parseFloat(dom.inputSensorTop?.value);

      function showFeedback(msg, type) {
        if (!dom.tankConfigFeedback) return;
        dom.tankConfigFeedback.textContent = msg;
        dom.tankConfigFeedback.className = `config-feedback ${type}`;
        dom.tankConfigFeedback.style.display = "block";
      }

      if (isNaN(capacidade) || capacidade <= 0) {
        showFeedback("Informe uma capacidade total válida maior que zero (ex: 10000 L).", "error");
        return;
      }
      if (isNaN(altura) || altura <= 0) {
        showFeedback("Informe uma altura útil válida maior que zero (ex: 200 cm).", "error");
        return;
      }
      if (isNaN(distTopo) || distTopo < 0) {
        showFeedback("A distância do sensor ao topo deve ser igual ou superior a 0 cm.", "error");
        return;
      }

      dom.btnSaveTankConfig.disabled = true;
      dom.btnSaveTankConfig.textContent = "Salvando...";

      try {
        const nextTankConfig = {
          capacidade_litros: capacidade,
          altura_total_cm: altura,
          distancia_sensor_topo: distTopo
        };

        if (isDemoMode) {
          currentTankConfig = nextTankConfig;
          if (dom.waterCapacity) {
            dom.waterCapacity.textContent = `${Math.round(capacidade).toLocaleString("pt-BR")} L`;
          }
          showFeedback("Configurações atualizadas (Modo Demonstração)!", "success");
          setTimeout(() => dom.tankConfigModal?.classList.remove("show"), 1200);
        } else {
          if (!currentCondoId) throw new Error("Nenhum condomínio selecionado.");
          const targetRef = ref(firebaseDb, `condominios/${currentCondoId}/config`);
          await update(targetRef, {
            capacidade_litros: capacidade,
            altura_total_cm: altura,
            distancia_sensor_topo: distTopo
          });

          currentTankConfig = nextTankConfig;
          if (dom.waterCapacity) {
            dom.waterCapacity.textContent = `${Math.round(capacidade).toLocaleString("pt-BR")} L`;
          }
          showFeedback("Configurações salvas no Firebase! O ESP32 sincronizará em instantes.", "success");
          setTimeout(() => dom.tankConfigModal?.classList.remove("show"), 1400);
        }
      } catch (err) {
        console.error("[Config] Erro ao salvar dimensões:", err);
        showFeedback(`Erro ao salvar: ${err.message}`, "error");
      } finally {
        dom.btnSaveTankConfig.disabled = false;
        dom.btnSaveTankConfig.textContent = "Salvar Configurações";
      }
    });
  }

// Navegação por Abas (SPA sem scroll vertical, preservando estilo pill)
  if (dom.tabOverview) {
    dom.tabOverview.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("overview");
    });
  }
  if (dom.tabAlerts) {
    dom.tabAlerts.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("alerts");
    });
  }
  if (dom.tabHistory) {
    dom.tabHistory.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("history");
    });
  }
  if (dom.tabAdmin) {
    dom.tabAdmin.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("admin");
    });
  }

  // Atalho no selo lateral "Monitoramento protegido" (somente se for Admin Universal)
  const localTagBadge = document.querySelector(".local-tag");
  if (localTagBadge) {
    localTagBadge.addEventListener("click", () => {
      if (isUniversalAdmin) {
        if (dom.tabAdmin) dom.tabAdmin.hidden = false;
        switchTab("admin");
      }
    });
  }
  // Auto-preenchimento inteligente de e-mails e senhas ao digitar o ID do condomínio
  if (dom.provCondoId) {
    dom.provCondoId.addEventListener("input", () => {
      const clean = dom.provCondoId.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
      if (clean.length >= 3) {
        if (dom.provSindicoEmail && (!dom.provSindicoEmail.value || dom.provSindicoEmail.dataset.auto === "1")) {
          dom.provSindicoEmail.value = `sindico.${clean}@smartwater.app`;
          dom.provSindicoEmail.dataset.auto = "1";
        }
        if (dom.provMoradorEmail && (!dom.provMoradorEmail.value || dom.provMoradorEmail.dataset.auto === "1")) {
          dom.provMoradorEmail.value = `moradores.${clean}@smartwater.app`;
          dom.provMoradorEmail.dataset.auto = "1";
        }
        if (dom.provSindicoPass && !dom.provSindicoPass.value) {
          dom.provSindicoPass.value = `Sindico@${clean.slice(0, 6)}26`;
        if (dom.provMoradorPass && !dom.provMoradorPass.value) {
          dom.provMoradorPass.value = `Agua@${clean.slice(0, 6)}26`;
        }
        if (dom.provEspEmail && (!dom.provEspEmail.value || dom.provEspEmail.dataset.auto === "1")) {
          dom.provEspEmail.value = `esp32.${clean}@smartwater.app`;
          dom.provEspEmail.dataset.auto = "1";
        }
        if (dom.provEspPass && !dom.provEspPass.value) {
          dom.provEspPass.value = `Esp32@${clean.slice(0, 6)}26`;
        }
          dom.provEspPass.value = `Esp32@${clean.slice(0, 6)}26`;
        }
        }
      }
    });
  }
  dom.provSindicoEmail?.addEventListener("keydown", () => { dom.provSindicoEmail.dataset.auto = "0"; });
  dom.provMoradorEmail?.addEventListener("keydown", () => { dom.provMoradorEmail.dataset.auto = "0"; });

  function copyTextSafe(text, buttonEl, feedbackLabel = "Copiado") {
    if (!text) return;
    const orig = buttonEl?.textContent;
    const done = () => {
      if (buttonEl) {
        buttonEl.textContent = feedbackLabel;
        setTimeout(() => { buttonEl.textContent = orig; }, 2200);
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      done();
    }
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  dom.btnCopyAdminUid?.addEventListener("click", () => {
    const uid = firebaseAuth?.currentUser?.uid;
    if (uid) copyTextSafe(uid, dom.btnCopyAdminUid, "UID Copiado");
  });

  dom.btnCopyClientKit?.addEventListener("click", () => {
    copyTextSafe(dom.provClientText?.value || "", dom.btnCopyClientKit, "Texto Copiado");
  });

  dom.btnDownloadClientKit?.addEventListener("click", () => {
    const cid = dom.provCondoId?.value.trim() || "condominio";
    downloadTextFile(`acessos-cliente-${cid}.txt`, dom.provClientText?.value || "");
  });

  dom.btnCopySecrets?.addEventListener("click", () => {
    copyTextSafe(dom.provSecretsText?.value || "", dom.btnCopySecrets, "Código Copiado");
  });

  dom.btnDownloadSecrets?.addEventListener("click", () => {
    downloadTextFile("secrets.h", dom.provSecretsText?.value || "");
  });

  if (dom.btnProvisionCondo) {
    dom.btnProvisionCondo.addEventListener("click", async () => {
      const showProvStatus = (msg, type = "success") => {
        if (!dom.provFeedback) return;
        dom.provFeedback.textContent = msg;
        dom.provFeedback.className = `config-feedback ${type}`;
        dom.provFeedback.style.display = "block";
      };

      const condoId = dom.provCondoId?.value.trim().toLowerCase();
      const condoName = dom.provCondoName?.value.trim() || `Condomínio ${condoId}`;
      const capacity = parseFloat(dom.provCapacity?.value) || 10000;
      const height = parseFloat(dom.provHeight?.value) || 200;
      const sensorTop = parseFloat(dom.provSensorTop?.value) || 20;

      const sindicoEmail = dom.provSindicoEmail?.value.trim();
      const sindicoPass = dom.provSindicoPass?.value || "";
      const moradorEmail = dom.provMoradorEmail?.value.trim();
      const moradorPass = dom.provMoradorPass?.value || "";

      const wifiSsid = dom.provWifiSsid?.value.trim() || "WIFI_DO_CONDOMINIO";
      const wifiPass = dom.provWifiPass?.value || "SENHA_DO_WIFI";
      const espEmail = dom.provEspEmail?.value.trim() || (firebaseAuth?.currentUser?.email || "esp32.master@smartwater.app");
      const espPass = dom.provEspPass?.value || "SENHA_DO_ESP32";
      const tgToken = dom.provTgToken?.value.trim() || "";
      const tgChat = dom.provTgChat?.value.trim() || "";

      if (!isValidCondoId(condoId)) {
        showProvStatus("Informe um ID válido para o condomínio (3 a 64 letras/números/underline).", "error");
        return;
      }
      if (!sindicoEmail || sindicoPass.length < 6) {
        showProvStatus("Informe o e-mail e uma senha de pelo menos 6 caracteres para o Síndico.", "error");
        return;
      }
      if (!moradorEmail || moradorPass.length < 6) {
        showProvStatus("Informe o e-mail e uma senha de pelo menos 6 caracteres para os Moradores.", "error");
        return;
      }
      if (sindicoEmail.toLowerCase() === moradorEmail.toLowerCase()) {
        showProvStatus("O e-mail do Síndico e o dos Moradores devem ser diferentes para separar as permissões.", "error");
        return;
      }

      dom.btnProvisionCondo.disabled = true;
      const origLabel = dom.btnProvisionCondo.textContent;
      dom.btnProvisionCondo.textContent = "Provisionando contas e permissões...";
      showProvStatus("Criando contas no Firebase Authentication e vinculando permissões...", "success");

      let secondaryApp = null;
      let sindicoUid = null;
      let moradorUid = null;
      let espUid = null;
      let dbProvisionOk = false;

      try {
        const fbConfig = getActiveFirebaseConfig();
        secondaryApp = initializeApp(fbConfig, `SmartWaterProvisioner_${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);

        async function getOrCreateUid(email, password) {
          try {
            const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            const uid = cred.user.uid;
            await signOut(secondaryAuth);
            return uid;
          } catch (authErr) {
            if (authErr?.code === "auth/email-already-in-use") {
              const cred = await signInWithEmailAndPassword(secondaryAuth, email, password);
              const uid = cred.user.uid;
              await signOut(secondaryAuth);
              return uid;
            }
            throw authErr;
          }
        }

        sindicoUid = await getOrCreateUid(sindicoEmail, sindicoPass);
        moradorUid = await getOrCreateUid(moradorEmail, moradorPass);

        // Criação automática garantida da conta exclusiva deste ESP32 no Firebase Auth
        if (espEmail && espPass && espPass.length >= 6) {
          try {
            espUid = await getOrCreateUid(espEmail, espPass);
          } catch (eErr) {
            console.warn('[Admin] Aviso ao criar conta do ESP32:', eErr);
          }
        }

        if (firebaseDb && firebaseAuth?.currentUser) {
          await set(ref(firebaseDb, `access/${sindicoUid}/${condoId}`), {
            read: true,
            write: false,
            calibrate: true,
            role: "sindico"
          });
          await set(ref(firebaseDb, `access/${moradorUid}/${condoId}`), {
            read: true,
            write: false,
            calibrate: false,
            role: "morador"
          });
          if (espUid) {
            await set(ref(firebaseDb, `access/${espUid}/${condoId}`), {
              read: false,
              write: true,
              role: "esp32"
            });
          }
          await set(ref(firebaseDb, `condominios/${condoId}/config`), {
            capacidade_litros: capacity,
            altura_total_cm: height,
            distancia_sensor_topo: sensorTop
          });
          dbProvisionOk = true;
          refreshAdminCondoList([condoId]);
        }
      } catch (err) {
        console.error("[Admin] Erro durante provisionamento:", err);
        showProvStatus(`Aviso ao gravar no Firebase: ${err.message || err.code}. Confira se seu UID possui "admin": true em /access.`, "error");
      } finally {
        if (secondaryApp) {
          try { await deleteApp(secondaryApp); } catch (_) {}
        }
        dom.btnProvisionCondo.disabled = false;
        dom.btnProvisionCondo.textContent = origLabel;
      }

      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const directLink = `${baseUrl}?id=${condoId}`;
      const fbConfig = getActiveFirebaseConfig();

      const clientKitText = [
        "SMARTWATER - CREDENCIAIS DE ACESSO AO MONITORAMENTO",
        `Condomínio: ${condoName}`,
        `Identificador: ${condoId}`,
        `Link de Acesso Direto: ${directLink}`,
        "",
        "------------------------------------------------------------",
        "1. ACESSO DA ADMINISTRAÇÃO / SÍNDICO",
        "Permissão: Monitoramento em tempo real, relatórios e calibração da caixa",
        `E-mail: ${sindicoEmail}`,
        `Senha:  ${sindicoPass}`,
        ...(sindicoUid ? [`UID:    ${sindicoUid}`] : []),
        "",
        "------------------------------------------------------------",
        "2. ACESSO DOS MORADORES / PORTARIA",
        "Permissão: Visualização em tempo real (somente leitura - sem calibração)",
        `E-mail: ${moradorEmail}`,
        `Senha:  ${moradorPass}`,
        ...(moradorUid ? [`UID:    ${moradorUid}`] : []),
        "",
        "------------------------------------------------------------",
        "COMO ADICIONAR O APLICATIVO NA TELA INICIAL DO CELULAR:",
        "- Android (Chrome): Abra o link acima, faça login e toque em 'Instalar app' no topo ou no menu do navegador > 'Adicionar à tela inicial'.",
        "- iPhone (Safari): Abra o link acima, faça login, toque no botão Compartilhar e selecione 'Adicionar à Tela de Início'."
      ].join("\n");

      const secretsCode = [
        "#pragma once",
        "",
        "// Identificação automática deste condomínio (não precisa editar o .ino)",
        `#define SECRET_CONDOMINIO_ID   "${condoId}"`,
        `#define SECRET_CONDOMINIO_NOME "${condoName}"`,
        "",
        "// Wi-Fi local do condomínio (2.4 GHz)",
        `#define WIFI_SSID       "${wifiSsid}"`,
        `#define WIFI_PASSWORD   "${wifiPass}"`,
        "",
        "// Projeto Firebase",
        `#define API_KEY         "${fbConfig.apiKey}"`,
        `#define DATABASE_URL    "${fbConfig.databaseURL}"`,
        "",
        "// Credencial do ESP32 no Firebase Authentication",
        `#define DEVICE_EMAIL    "${espEmail}"`,
        `#define DEVICE_PASSWORD "${espPass}"`,
        "",
        "// Bot do Telegram do Condomínio",
        `#define ENABLE_TELEGRAM         ${tgToken && tgChat ? 1 : 0}`,
        `#define TELEGRAM_BOT_TOKEN      "${tgToken}"`,
        `#define TELEGRAM_CHAT_ID        "${tgChat}"`,
        "#define TELEGRAM_SIMULATED_MODE false"
      ].join("\n");

      if (dom.provClientText) dom.provClientText.value = clientKitText;
      if (dom.provSecretsText) dom.provSecretsText.value = secretsCode;
      if (dom.provResultsBox) dom.provResultsBox.hidden = false;

      if (dbProvisionOk) {
        showProvStatus(`Condomínio "${condoName}" (${condoId}) provisionado com sucesso no Firebase! Copie ou baixe os arquivos abaixo.`, "success");
      }
    });
  }

  // Atalho do Histórico na barra lateral / mobile
  const sidebarHistoryBtn = document.querySelector('a[href="#history-section"]');
  if (sidebarHistoryBtn) {
    sidebarHistoryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("history");
    });
  }

  // Desativação total do modo demo para clientes comerciais: Botão abre apenas Diagnóstico
  if (dom.demoBtn) {
    dom.demoBtn.addEventListener("click", () => {
      updateDiagnosticsUI(latestTelemetryData);
      dom.diagModal?.classList.add("show");
    });
  }

  if (dom.closeDiagModal) {
    dom.closeDiagModal.addEventListener("click", () => {
      dom.diagModal?.classList.remove("show");
    });
  }

  if (dom.btnTriggerTestAlert) {
    dom.btnTriggerTestAlert.addEventListener("click", async () => {
      playAlertChime(750, 0.32);
      const originalText = dom.btnTriggerTestAlert.textContent;
      dom.btnTriggerTestAlert.disabled = true;
      dom.btnTriggerTestAlert.textContent = "Executando diagnóstico...";

      if (dom.diagTestFeedback) {
        dom.diagTestFeedback.textContent = "Alerta sonoro emitido. Verificando comunicação com o controlador...";
        dom.diagTestFeedback.style.color = "#bae6fd";
      }

      let latencyInfo = "";
      let telegramTriggered = false;

      if (firebaseDb && firebaseAuth?.currentUser && currentCondoId) {
        const t0 = performance.now();
        try {
          const snap = await get(ref(firebaseDb, `condominios/${currentCondoId}/telemetria`));
          const latencyMs = Math.max(1, Math.round(performance.now() - t0));
          latencyInfo = ` (${latencyMs} ms)`;
          if (snap.exists()) {
            latestTelemetryData = snap.val();
            updateDiagnosticsUI(latestTelemetryData);
          }
          await update(ref(firebaseDb, `condominios/${currentCondoId}/config`), {
            capacidade_litros: currentTankConfig.capacidade_litros || 10000,
            altura_total_cm: currentTankConfig.altura_total_cm || 200,
            distancia_sensor_topo: currentTankConfig.distancia_sensor_topo ?? 20,
            teste_id: Date.now()
          });
          telegramTriggered = true;
        } catch (err) {
          console.warn("[Diagnóstico] Teste local executado (sem escrita remota):", err);
        }
      } else {
        updateDiagnosticsUI(latestTelemetryData);
      }

      dom.btnTriggerTestAlert.disabled = false;
      dom.btnTriggerTestAlert.textContent = originalText;

      if (dom.diagTestFeedback) {
        if (telegramTriggered && latestTelemetryData) {
          dom.diagTestFeedback.textContent = `Teste concluído${latencyInfo}: Alerta sonoro emitido, telemetria sincronizada e aviso enviado ao controlador.`;
        } else if (telegramTriggered) {
          dom.diagTestFeedback.textContent = `Alerta sonoro e conexão validados${latencyInfo}. Comando registrado para o controlador.`;
        } else {
          dom.diagTestFeedback.textContent = "Alerta sonoro e interface validados. Faça login para disparar o teste remoto.";
        }
        dom.diagTestFeedback.style.color = "#6ee7b7";
        setTimeout(() => {
          if (dom.diagTestFeedback) {
            dom.diagTestFeedback.textContent = "Pressione para validar o funcionamento do hardware e alertas.";
            dom.diagTestFeedback.style.color = "";
          }
        }, 6000);
      }
    });
  }

  const handleLoginSubmit = async () => {
    const email = dom.loginEmail?.value.trim();
    const password = dom.loginPassword?.value;
    if (!email || !password) return showLogin("Preencha e-mail e senha.");
    try {
      if (dom.loginBtn) dom.loginBtn.disabled = true;
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      if (dom.loginPassword) dom.loginPassword.value = "";
    } catch (error) {
      console.error("Falha de autenticação:", error);
      showLogin("Acesso negado. Confira a conta e as permissões deste condomínio.");
    } finally {
      if (dom.loginBtn) dom.loginBtn.disabled = false;
    }
  };

  if (dom.loginBtn) dom.loginBtn.addEventListener("click", handleLoginSubmit);
  dom.loginPassword?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginSubmit();
  });
  dom.loginEmail?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLoginSubmit();
  });
  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener("click", async () => {
      // Limpa qualquer cache de papel ou preferências locais ao deslogar
      localStorage.removeItem("smartwater_role");
      localStorage.removeItem(LAST_CONDO_STORAGE_KEY);
      if (firebaseAuth) await signOut(firebaseAuth);
      window.location.search = "";
    });
  }
}

// 8. INICIALIZAÇÃO DA APLICAÇÃO
function init() {
  // No modelo comercial, identificador do condomínio já vinculado desde o início
  if (dom.condoBadge) dom.condoBadge.textContent = currentCondoId;

  // Controle de visibilidade Comercial (Admin vs Cliente)
  const isAdmin = urlParams.get("admin") === "1";
  if (isAdmin) {
    if (dom.tabAdmin) dom.tabAdmin.hidden = false;
  } else {
    if (dom.switchCondoBtn) dom.switchCondoBtn.style.display = "none";
    if (dom.settingsBtn) dom.settingsBtn.style.display = "none";
  }

  // Registra todos os eventos de clique da interface primeiro
  setupModals();

  if (dom.installBtn) {
    dom.installBtn.addEventListener("click", async () => {
      if (!installPrompt) return;
      const prompt = installPrompt;
      installPrompt = null;
      dom.installBtn.hidden = true;
      await prompt.prompt();
    });
  }

  window.addEventListener("online", renderConnectivity);
  window.addEventListener("offline", renderConnectivity);
  try {
    renderConnectivity();
  } catch (err) {
    console.warn("[Init] Aviso ao renderizar estado inicial:", err);
  }

  initTankBubbles();
  startHeartbeatWatchdog();

  try {
    initializeAuthentication();
  } catch (err) {
    console.error("[Init] Falha ao iniciar autenticação Firebase:", err);
    showLogin("Não foi possível inicializar a autenticação. Verifique sua conexão.");
  }

  if (!isValidCondoId(currentCondoId)) {
    showLogin("O identificador informado para o condomínio é inválido.");
  }
  // Modal de seleção geral restrito ao administrador com parâmetro explícito (?portal=1)
  if (isAdmin && urlParams.get("portal") === "1") {
    dom.portalModal?.classList.add("show");
  }
}

// Dispara imediatamente se o DOM já estiver pronto ou aguarda o DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
