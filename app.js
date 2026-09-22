import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js";

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

// 2. CAPTURA DE ID DO CONDOMÍNIO (URL PARAMS)
const urlParams = new URLSearchParams(window.location.search);
let currentCondoId = urlParams.get("id");
const LAST_CONDO_STORAGE_KEY = "smartwaterweb_last_condo_id";
const runningStandalone = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;
if (!currentCondoId && runningStandalone) {
  const lastCondoId = localStorage.getItem(LAST_CONDO_STORAGE_KEY);
  if (lastCondoId && /^[a-zA-Z0-9_-]{3,64}$/.test(lastCondoId)) currentCondoId = lastCondoId;
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
  tankConfigFeedback: document.getElementById("tank-config-feedback")
};

// Variáveis de Estado
let isDemoMode = false;
let demoInterval = null;
let lastHeartbeatTime = null;
let heartbeatCheckInterval = null;
let firebaseDb = null;
let currentDbRef = null;
let currentConfigRef = null;
let firebaseAuth = null;
let currentUnsubscribe = null;
let configUnsubscribe = null;
let authUnsubscribe = null;
let activeFirebaseApp = null;
let lastAlertKey = null;

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
    if (dom.waterVolume) dom.waterVolume.textContent = "Sensor Desconectado";
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

  // 3. Status da Bomba
  const isPumpActive = Boolean(data.bomba_ligada);
  if (dom.pumpCard) {
    if (isPumpActive) {
      dom.pumpCard.classList.add("active");
      dom.pumpCard.classList.remove("offline-pump");
      dom.pumpStateText.textContent = "BOMBA ATIVA";
      dom.pumpStateText.className = "pump-state-headline active";
      dom.pumpStateDesc.textContent = "Motor em funcionamento com fluxo contínuo de água";
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

  const timestampMs = Number(data.timestamp_ms || 0);
  const timestampIsValid = Boolean(data.timestamp_valido) && timestampMs > 0;
  lastHeartbeatTime = timestampIsValid ? timestampMs : Date.now();
  setConnectionStatus(Date.now() - lastHeartbeatTime <= 25000);

  // 6. Alertas Inteligentes
  handleAlerts(percent, data.alerta, isPumpActive);
}

// Formata segundos de uptime em texto legível
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
  } else {
    dom.alertBanner.className = "alert-banner";
  }

  if (alertKey !== "OK" && alertKey !== lastAlertKey) {
    playAlertBeep(alertKey === "SOBRECARGA_BOMBA" ? 880 : 750, 0.4);
  }
  lastAlertKey = alertKey;
}

// Status de Conexão com ESP32
function setConnectionStatus(online) {
  if (!dom.statusPill || !dom.statusText) return;
  if (online) {
    dom.statusPill.classList.remove("offline");
    dom.statusText.textContent = "ESP32 Online";
  } else {
    dom.statusPill.classList.add("offline");
    dom.statusText.textContent = "Sem Sinal ESP32";
  }
}

// Monitora se o ESP32 parou de enviar sinais há mais de 25 segundos
function startHeartbeatWatchdog() {
  if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval);
  heartbeatCheckInterval = setInterval(() => {
    if (isDemoMode) {
      if (dom.diagHeartbeat) dom.diagHeartbeat.textContent = "Modo Demo Ativo";
      return;
    }
    if (!lastHeartbeatTime) {
      if (dom.diagHeartbeat) dom.diagHeartbeat.textContent = "Aguardando 1º envio...";
      setConnectionStatus(false);
      return;
    }

    const elapsedSec = Math.floor((Date.now() - lastHeartbeatTime) / 1000);
    if (dom.diagHeartbeat) {
      dom.diagHeartbeat.textContent = `Há ${elapsedSec}s atrás`;
    }

    if (elapsedSec > 25) {
      setConnectionStatus(false);
    } else {
      setConnectionStatus(true);
    }
  }, 1000);
}

// Criação de bolhas dinâmicas flutuantes no tanque
function initTankBubbles() {
  if (!dom.bubblesContainer) return;
  dom.bubblesContainer.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const size = Math.random() * 8 + 4;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.left = `${Math.random() * 80 + 10}%`;
    bubble.style.animationDuration = `${Math.random() * 3 + 2.5}s`;
    bubble.style.animationDelay = `${Math.random() * 3}s`;
    dom.bubblesContainer.appendChild(bubble);
  }
}

// 5. CONEXÃO COM O FIREBASE REALTIME DATABASE
function isValidCondoId(condoId) {
  return /^[a-z0-9_-]{3,64}$/i.test(condoId);
}

function disconnectFirebaseListener() {
  if (currentUnsubscribe) {
    currentUnsubscribe();
    currentUnsubscribe = null;
  }
  if (configUnsubscribe) {
    configUnsubscribe();
    configUnsubscribe = null;
  }
  currentDbRef = null;
  currentConfigRef = null;
}

function connectToFirebase(condoId) {
  if (isDemoMode) return;
  if (!isValidCondoId(condoId)) {
    dom.alertBanner.className = "alert-banner critical";
    dom.alertMessage.textContent = "Identificador de condomínio inválido.";
    setConnectionStatus(false);
    return;
  }

  disconnectFirebaseListener();
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
        return;
      }
      updateDashboardUI(data);
    }, (error) => {
      console.error("[Firebase] Erro ao ler dados:", error);
      if (dom.alertBanner) {
        dom.alertBanner.className = "alert-banner critical";
        dom.alertMessage.textContent = `Erro no Firebase: ${error.message}. Verifique as Regras de leitura (.read: true).`;
      }
      setConnectionStatus(false);
    });
  } catch (err) {
    console.error("[Firebase] Falha na inicialização:", err);
  }
}

function showLogin(message = "Entre com a conta autorizada para este condomínio.") {
  if (dom.loginMessage) dom.loginMessage.textContent = message;
  if (dom.loginModal) dom.loginModal.classList.add("show");
}

function initializeAuthentication() {
  const config = getActiveFirebaseConfig();
  if (!activeFirebaseApp) {
    activeFirebaseApp = initializeApp(config);
    firebaseDb = getDatabase(activeFirebaseApp);
    firebaseAuth = getAuth(activeFirebaseApp);
  }

  if (authUnsubscribe) authUnsubscribe();
  authUnsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
    if (user) {
      dom.loginModal?.classList.remove("show");
      if (currentCondoId && !isDemoMode) connectToFirebase(currentCondoId);
    } else {
      disconnectFirebaseListener();
      setConnectionStatus(false);
      if (currentCondoId) showLogin();
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
    dom.demoBtn.classList.add("demo-active");
    const demoLabel = dom.demoBtn.querySelector("span");
    if (demoLabel) demoLabel.textContent = "Demonstração ativa";
    else dom.demoBtn.textContent = "Demonstração ativa";
    if (dom.alertBanner) {
      dom.alertBanner.className = "alert-banner warning";
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
    if (dom.alertBanner) dom.alertBanner.className = "alert-banner";
    if (currentCondoId) {
      if (firebaseAuth?.currentUser) connectToFirebase(currentCondoId);
      else showLogin();
    }
  }
}

// 7. CONTROLE DE MODAIS E NAVEGAÇÃO MULTI-TENANT
function setupModals() {
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

  // Botão Demo Mode
  if (dom.demoBtn) {
    dom.demoBtn.addEventListener("click", toggleDemoMode);
  }

  if (dom.loginBtn) {
    dom.loginBtn.addEventListener("click", async () => {
      const email = dom.loginEmail.value.trim();
      const password = dom.loginPassword.value;
      if (!email || !password) return showLogin("Preencha e-mail e senha.");
      try {
        dom.loginBtn.disabled = true;
        await signInWithEmailAndPassword(firebaseAuth, email, password);
        dom.loginPassword.value = "";
      } catch (error) {
        console.error("Falha de autenticação:", error);
        showLogin("Acesso negado. Confira a conta e as permissões deste condomínio.");
      } finally {
        dom.loginBtn.disabled = false;
      }
    });
  }

  if (dom.logoutBtn) {
    dom.logoutBtn.addEventListener("click", async () => {
      if (firebaseAuth) await signOut(firebaseAuth);
    });
  }
}

// 8. INICIALIZAÇÃO DA APLICAÇÃO
function init() {
  if (dom.installBtn) {
    dom.installBtn.addEventListener("click", async () => {
      if (!installPrompt) return;
      const prompt = installPrompt;
      installPrompt = null;
      dom.installBtn.hidden = true;
      await prompt.prompt();
    });
  }
  setupModals();
  initTankBubbles();
  startHeartbeatWatchdog();
  initializeAuthentication();

  // Se nenhum ID for passado na URL (ex: acessou apenas index.html)
  if (!currentCondoId) {
    console.log("Nenhum ID fornecido na URL. Exibindo portal de seleção...");
    if (dom.condoTitle) dom.condoTitle.textContent = "Portal de Monitoramento";
    if (dom.condoBadge) dom.condoBadge.textContent = "SELECIONE UM CONDOMÍNIO";
    dom.portalModal.classList.add("show");
    // Inicia demonstração interativa enquanto aguarda escolha
    toggleDemoMode();
  } else {
    if (dom.condoBadge) dom.condoBadge.textContent = currentCondoId;
    if (!isValidCondoId(currentCondoId)) {
      showLogin("O identificador informado na URL é inválido.");
    }
  }
}

// Dispara ao carregar a página
document.addEventListener("DOMContentLoaded", init);
