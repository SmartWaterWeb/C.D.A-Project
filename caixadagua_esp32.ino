/**
 * ============================================================================
 * SISTEMA IOT DE MONITORAMENTO DE CAIXA D'ÁGUA MULTI-CONDOMÍNIO
 * Firmware para ESP32 com Firebase Realtime Database
 * Biblioteca: Firebase ESP Client por Mobizt (v4.x.x ou superior)
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include <Preferences.h>
#include "secrets.h"
#include "telegram_service.h"

// Fornece informações auxiliares para geração de tokens e RTDB
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// ============================================================================
// 1. CONFIGURAÇÕES DE WI-FI E FIREBASE
// ============================================================================
// WIFI_SSID, WIFI_PASSWORD, API_KEY, DATABASE_URL, DEVICE_EMAIL e
// DEVICE_PASSWORD ficam em secrets.h, que não deve ser enviado ao GitHub.

// ============================================================================
// 2. IDENTIFICADOR EXCLUSIVO DESTE CONDOMÍNIO (MULTI-TENANT)
// Cada placa gravada deve ter seu próprio ID (ex: "condominio_alpha", "residencial_flores")
// ============================================================================
const char* CONDOMINIO_ID = "condominio_alpha";
const char* CONDOMINIO_NOME = "Condomínio Edifício Alpha - Reservatório Superior";

// ============================================================================
// 3. DIMENSÕES DO RESERVATÓRIO E PARÂMETROS FÍSICOS
// Sincronizados com o Firebase (/config) e gravados na Flash permanente (NVS)
// ============================================================================
Preferences preferences;
float alturaTotalCm       = 200.0; // Altura útil da caixa d'água (ex: 200 cm)
float distanciaSensorTopo = 20.0;  // Distância do sensor até o nível 100% (ex: 20 cm)
float capacidadeLitros    = 10000.0; // Capacidade total em litros (ex: 10.000 L)

// Controle de sincronização de configurações remotas
const unsigned long INTERVALO_CONFIG_SYNC_MS = 15000; // Consulta /config a cada 15 segundos
unsigned long ultimaSincConfigMs = 0;
bool configSincronizada = false;

// ============================================================================
// 4. PINAGEM DOS SENSORES E ATUADORES
// IMPORTANTE: Para entradas analógicas com Wi-Fi ativo, utilize APENAS pinos do ADC1:
// GPIO 32, 33, 34, 35, 36, 39. (Pinos do ADC2 entram em conflito com o Wi-Fi).
// ============================================================================

// Opção A: Sensor Ultrassônico (HC-SR04 ou JSN-SR04T à prova d'água)
#define USE_ULTRASONIC_SENSOR true
#define PIN_TRIG        5
#define PIN_ECHO        18

// Opção B: Sensor de Nível Hidrostático / Pressão Analógico (4-20mA ou 0-5V com divisor)
#define PIN_ADC_NIVEL   34

// Monitoramento da Bomba e Energia
#define PIN_STATUS_BOMBA 19  // Entrada digital (lê feedback de contator/relé da bomba, HIGH=Ligada)
#define PIN_SENSOR_ACS712 35 // Entrada analógica ADC1 para sensor de corrente (ex: ACS712)
#define TENSAO_REDE_V    220.0 // Tensão nominal da rede (127V ou 220V)
#define ACS_ZERO_V       1.65  // Ajustar durante a calibração sem carga
#define ACS_SENS_V_A     0.100 // ACS712-20A: aproximadamente 100 mV/A
#define ACS_AMOSTRAS     400
#define ACS_INTERVALO_US 500

// Amostragem rápida; publicações normais permanecem espaçadas para economizar tráfego.
const unsigned long INTERVALO_LEITURA_MS = 2000;
const unsigned long INTERVALO_HEARTBEAT_MS = 4000;
const unsigned long INTERVALO_HISTORICO_MS = 15UL * 60UL * 1000UL;
const unsigned long INTERVALO_RETENTATIVA_HISTORICO_MS = 60UL * 1000UL;
const unsigned long INTERVALO_RESUMO_TELEGRAM_MS = 12UL * 60UL * 60UL * 1000UL;
const unsigned long INTERVALO_PROGRESSO_TELEGRAM_MS = 5UL * 60UL * 1000UL;
unsigned long ultimaLeituraMs = 0;
unsigned long ultimaPublicacaoMs = 0;
unsigned long ultimaTentativaHistoricoMs = 0;
unsigned long long ultimoBucketHistoricoPublicado = 0;
bool publicacaoConcluida = false;
float ultimoNivelPublicado = 0.0;
bool ultimoNivelValidoPublicado = false;
bool ultimaBombaPublicada = false;
String ultimoAlertaPublicado = "";
unsigned long ultimaTentativaWifiMs = 0;
unsigned long ultimoResumoTelegramMs = 0;
unsigned long inicioFalhaWifiMs = 0;
bool falhaWifiEmAndamento = false;

// Objetos do Firebase
FirebaseData fbdo;
FirebaseData fbdoConfig;
FirebaseAuth auth;
FirebaseConfig config;
float ultimoNivelValido = 0.0;
bool possuiNivelValido = false;

// Estado local usado somente para evitar notificações repetidas no Telegram.
bool estadosTelegramInicializados = false;
bool telegramBombaLigada = false;
bool telegramFalhaSensor = false;
bool telegramSobrecarga = false;
bool telegramNivelBaixo = false;
bool telegramNivelAlto = false;
bool telegramProgressoInicializado = false;
float telegramUltimoNivelProgresso = 0.0;
unsigned long ultimoProgressoTelegramMs = 0;

void enfileirarAvisoTelegram(AlertTopic topico, const char* detalhe);

// ============================================================================
// GERENCIAMENTO DE CONFIGURAÇÕES LOCAIS (NVS) E REMOTAS (FIREBASE)
// ============================================================================
void carregarConfiguracoesLocais() {
    preferences.begin("aquapulse", false);
    alturaTotalCm = preferences.getFloat("alt_total", 200.0);
    distanciaSensorTopo = preferences.getFloat("dist_topo", 20.0);
    capacidadeLitros = preferences.getFloat("cap_litros", 10000.0);
    preferences.end();

    Serial.println("[Config] Configurações físicas carregadas da Flash (NVS):");
    Serial.printf("   > Altura Útil: %.1f cm\n", alturaTotalCm);
    Serial.printf("   > Distância Topo: %.1f cm\n", distanciaSensorTopo);
    Serial.printf("   > Capacidade: %.0f L\n", capacidadeLitros);
}

void salvarConfiguracoesLocais(float alt, float dist, float cap) {
    preferences.begin("aquapulse", false);
    preferences.putFloat("alt_total", alt);
    preferences.putFloat("dist_topo", dist);
    preferences.putFloat("cap_litros", cap);
    preferences.end();
}

void sincronizarConfiguracaoFirebase() {
    if (WiFi.status() != WL_CONNECTED || !Firebase.ready()) return;

    String caminhoConfig = "/condominios/" + String(CONDOMINIO_ID) + "/config";

    if (Firebase.RTDB.getJSON(&fbdoConfig, caminhoConfig.c_str())) {
        String tipo = fbdoConfig.dataType();
        if (tipo == "json") {
            FirebaseJson &json = fbdoConfig.jsonObject();
            FirebaseJsonData data;

            bool mudou = false;
            float novaAlt = alturaTotalCm;
            float novaDist = distanciaSensorTopo;
            float novaCap = capacidadeLitros;

            if (json.get(data, "altura_total_cm")) {
                float val = data.floatValue;
                if (val > 0 && abs(val - alturaTotalCm) > 0.01) {
                    novaAlt = val;
                    mudou = true;
                }
            }
            if (json.get(data, "distancia_sensor_topo")) {
                float val = data.floatValue;
                if (val >= 0 && abs(val - distanciaSensorTopo) > 0.01) {
                    novaDist = val;
                    mudou = true;
                }
            }
            if (json.get(data, "capacidade_litros")) {
                float val = data.floatValue;
                if (val > 0 && abs(val - capacidadeLitros) > 0.01) {
                    novaCap = val;
                    mudou = true;
                }
            }

            if (mudou) {
                alturaTotalCm = novaAlt;
                distanciaSensorTopo = novaDist;
                capacidadeLitros = novaCap;
                salvarConfiguracoesLocais(alturaTotalCm, distanciaSensorTopo, capacidadeLitros);
                Serial.println("[Config] Novas configurações recebidas do Firebase e salvas na Flash!");
                Serial.printf("   > Altura Útil: %.1f cm | Dist. Topo: %.1f cm | Capacidade: %.0f L\n",
                              alturaTotalCm, distanciaSensorTopo, capacidadeLitros);
                char aviso[160];
                snprintf(aviso, sizeof(aviso),
                         "📐 Calibração atualizada\nCaixa: %.0f L · altura: %.1f cm\nSensor: %.1f cm do topo",
                         capacidadeLitros, alturaTotalCm, distanciaSensorTopo);
                enfileirarAvisoTelegram(AlertTopic::MODE, aviso);
            }
            configSincronizada = true;
        } else if (tipo == "null") {
            Serial.println("[Config] Nó /config não encontrado. Inicializando com parâmetros locais padrão...");
            FirebaseJson defaultConf;
            defaultConf.set("altura_total_cm", alturaTotalCm);
            defaultConf.set("distancia_sensor_topo", distanciaSensorTopo);
            defaultConf.set("capacidade_litros", capacidadeLitros);
            Firebase.RTDB.setJSON(&fbdoConfig, caminhoConfig.c_str(), &defaultConf);
            configSincronizada = true;
        }
    }
}

// ============================================================================
// FUNÇÃO: Medir Nível da Água
// ============================================================================
float lerNivelPercentual() {
#if USE_ULTRASONIC_SENSOR
    // Pulso no pino TRIG
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    // Medição do pulso de retorno (ECHO) com timeout de 30ms (~5 metros)
    long duracao = pulseIn(PIN_ECHO, HIGH, 30000);

    if (duracao == 0) {
        Serial.println("[Sensor] Falha na leitura do sensor ultrassonico!");
        Serial.flush();
        return -1.0; // Sinaliza erro de leitura
    }

    // Distância medida em centímetros: velocidade do som = 0.0343 cm/us
    float distanciaCm = (duracao * 0.0343) / 2.0;

    // Converte distância para altura de água usando as dimensões calibradas
    float alturaAguaCm = (alturaTotalCm + distanciaSensorTopo) - distanciaCm;
    if (alturaAguaCm < 0) alturaAguaCm = 0;
    if (alturaAguaCm > alturaTotalCm) alturaAguaCm = alturaTotalCm;

    float percentual = (alturaAguaCm / alturaTotalCm) * 100.0;
    return percentual;
#else
    // Leitura por sensor analógico hidrostático no pino ADC1
    int raw = analogRead(PIN_ADC_NIVEL);
    // ESP32 ADC: 0 a 4095 (12 bits)
    float percentual = (raw / 4095.0) * 100.0;
    return constrain(percentual, 0.0, 100.0);
#endif
}

// ============================================================================
// FUNÇÃO: Medir Corrente e Potência Elétrica
// ============================================================================
float lerCorrenteAmperes() {
    double somaQuadrados = 0.0;
    for (int i = 0; i < ACS_AMOSTRAS; i++) {
        float tensaoSensor = (analogRead(PIN_SENSOR_ACS712) / 4095.0) * 3.3;
        float correnteInstantanea = (tensaoSensor - ACS_ZERO_V) / ACS_SENS_V_A;
        somaQuadrados += correnteInstantanea * correnteInstantanea;
        delayMicroseconds(ACS_INTERVALO_US);
    }

    float correnteRms = sqrt(somaQuadrados / ACS_AMOSTRAS);
    if (correnteRms < 0.2) correnteRms = 0.0;
    return correnteRms;
}

unsigned long long obterTimestampMs(bool &valido) {
    time_t agora = time(nullptr);
    valido = agora > 1700000000;
    return valido ? ((unsigned long long)agora * 1000ULL) : 0ULL;
}

void enfileirarAvisoTelegram(AlertTopic topico, const char* detalhe) {
    if (!telegramConfigured() || detalhe == nullptr || detalhe[0] == '\0') return;

    // O bot já é exclusivo deste condomínio: repetir nome e ID em todo aviso
    // ocupa a tela sem ajudar quem acompanha o grupo.
    if (strlen(detalhe) >= 256) {
        Serial.println("[Telegram] Mensagem descartada por exceder o limite local.");
        return;
    }
    if (!enqueueTelegramAlert(detalhe, topico)) {
        Serial.println("[Telegram] Não foi possível registrar o alerta na fila.");
    }
}

void processarTransicoesTelegram(float nivelPercentual, bool nivelValido,
                                  bool bombaLigada, float correnteA) {
    bool falhaSensorAtual = !nivelValido;

    // Histerese evita alternância contínua quando a corrente oscila no limite.
    bool sobrecargaAtual = telegramSobrecarga
        ? (bombaLigada && correnteA > 14.0)
        : (bombaLigada && correnteA > 15.0);

    // Durante uma falha do sensor, mantém-se o último estado de nível conhecido.
    bool nivelBaixoAtual = telegramNivelBaixo;
    bool nivelAltoAtual = telegramNivelAlto;
    if (nivelValido) {
        nivelBaixoAtual = telegramNivelBaixo ? nivelPercentual < 23.0 : nivelPercentual <= 20.0;
        nivelAltoAtual = telegramNivelAlto ? nivelPercentual > 92.0 : nivelPercentual >= 95.0;
    }

    if (!estadosTelegramInicializados) {
        estadosTelegramInicializados = true;
        telegramBombaLigada = bombaLigada;
        telegramFalhaSensor = falhaSensorAtual;
        telegramSobrecarga = sobrecargaAtual;
        telegramNivelBaixo = nivelBaixoAtual;
        telegramNivelAlto = nivelAltoAtual;

        char detalhe[160];
        if (nivelValido) {
            snprintf(detalhe, sizeof(detalhe),
                     "✅ Monitor iniciado · %s\nNível %.1f%% · ~%.0f L\nBomba %s",
                     CONDOMINIO_NOME, nivelPercentual, capacidadeLitros * nivelPercentual / 100.0,
                     bombaLigada ? "ligada" : "desligada");
        } else {
            snprintf(detalhe, sizeof(detalhe),
                     "⚠️ Monitor iniciado · %s\nSensor sem leitura · bomba %s",
                     CONDOMINIO_NOME, bombaLigada ? "ligada" : "desligada");
        }
        enfileirarAvisoTelegram(AlertTopic::BOOT, detalhe);

        if (falhaSensorAtual) {
            enfileirarAvisoTelegram(AlertTopic::SENSOR, "🔴 Sensor sem leitura\nVerifique alimentação e cabos.");
        }
        if (sobrecargaAtual) {
            snprintf(detalhe, sizeof(detalhe), "🔴 Corrente alta: %.1f A\nVerifique a bomba (limite 15 A).", correnteA);
            enfileirarAvisoTelegram(AlertTopic::FAULT, detalhe);
        }
        if (nivelBaixoAtual) {
            snprintf(detalhe, sizeof(detalhe),
                     "🔴 Nível crítico: %.1f%%\n~%.0f L · Verifique abastecimento.",
                     nivelPercentual, capacidadeLitros * nivelPercentual / 100.0);
            enfileirarAvisoTelegram(AlertTopic::LEVEL, detalhe);
        }
        if (nivelAltoAtual) {
            snprintf(detalhe, sizeof(detalhe),
                     "🟠 Nível alto: %.1f%%\nVerifique o controle da bomba.",
                     nivelPercentual);
            enfileirarAvisoTelegram(AlertTopic::LEVEL, detalhe);
        }
        return;
    }

    if (falhaSensorAtual != telegramFalhaSensor) {
        char detalhe[160];
        if (falhaSensorAtual) {
            snprintf(detalhe, sizeof(detalhe),
                     "🔴 Sensor sem leitura\nÚltimo nível: %.1f%% (não atual)\nVerifique os cabos.",
                     ultimoNivelValido);
        } else {
            snprintf(detalhe, sizeof(detalhe), "🟢 Sensor normal\nNível: %.1f%%", nivelPercentual);
        }
        enfileirarAvisoTelegram(AlertTopic::SENSOR, detalhe);
        telegramFalhaSensor = falhaSensorAtual;
    }

    if (sobrecargaAtual != telegramSobrecarga) {
        char detalhe[160];
        snprintf(detalhe, sizeof(detalhe),
                 sobrecargaAtual
                     ? "🔴 Corrente alta: %.1f A\nVerifique a bomba (limite 15 A)."
                     : "🟢 Corrente normal: %.1f A",
                 correnteA);
        enfileirarAvisoTelegram(AlertTopic::FAULT, detalhe);
        telegramSobrecarga = sobrecargaAtual;
    }

    char detalhe[160];
    if (nivelBaixoAtual != telegramNivelBaixo) {
        snprintf(
            detalhe,
            sizeof(detalhe),
            nivelBaixoAtual
                ? "🔴 Nível crítico: %.1f%%\n~%.0f L · Verifique abastecimento."
                : "🟢 Nível saiu da faixa crítica\n%.1f%% · ~%.0f L",
            nivelPercentual, capacidadeLitros * nivelPercentual / 100.0
        );
        enfileirarAvisoTelegram(AlertTopic::LEVEL, detalhe);
        telegramNivelBaixo = nivelBaixoAtual;
    }

    if (nivelAltoAtual != telegramNivelAlto) {
        snprintf(
            detalhe,
            sizeof(detalhe),
            nivelAltoAtual
                ? "🟠 Nível alto: %.1f%%\nVerifique o controle da bomba."
                : "🟢 Nível voltou ao normal: %.1f%%",
            nivelPercentual
        );
        enfileirarAvisoTelegram(AlertTopic::LEVEL, detalhe);
        telegramNivelAlto = nivelAltoAtual;
    }

    if (bombaLigada != telegramBombaLigada) {
        if (nivelValido) {
            snprintf(detalhe, sizeof(detalhe),
                     bombaLigada ? "⚙️ Bomba ligada\nNível %.1f%% · Corrente %.1f A"
                                 : "⚙️ Bomba desligada\nNível %.1f%% · Corrente %.1f A",
                     nivelPercentual, correnteA);
        } else {
            snprintf(detalhe, sizeof(detalhe),
                     bombaLigada ? "⚙️ Bomba ligada\nSensor de nível indisponível"
                                 : "⚙️ Bomba desligada\nSensor de nível indisponível");
        }
        enfileirarAvisoTelegram(AlertTopic::PUMP, detalhe);
        telegramBombaLigada = bombaLigada;
    }
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n==================================================");
    Serial.println("INICIALIZANDO MONITOR DE CAIXA D'ÁGUA IOT ESP32");
    Serial.printf("Condomínio ID: %s\n", CONDOMINIO_ID);
    Serial.println("==================================================");

    // Carrega dimensões físicas da caixa d'água salvas na Flash (NVS)
    carregarConfiguracoesLocais();

    // Configuração dos pinos
    pinMode(PIN_STATUS_BOMBA, INPUT_PULLDOWN);
#if USE_ULTRASONIC_SENSOR
    pinMode(PIN_TRIG, OUTPUT);
    digitalWrite(PIN_TRIG, LOW);
    pinMode(PIN_ECHO, INPUT_PULLDOWN);
#endif
    analogReadResolution(12); // 12 bits de resolução ADC (0-4095)

    // Conexão Wi-Fi
    Serial.print("Conectando ao Wi-Fi: ");
    Serial.println(WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false); // Mantém clock estável: previne ruídos na Serial e melhora precisão do sensor
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int tentativas = 0;
    while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
        delay(500);
        Serial.print(".");
        tentativas++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[Wi-Fi] Conectado com sucesso!");
        Serial.printf("[Wi-Fi] IP Local: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[Wi-Fi] RSSI: %d dBm\n", WiFi.RSSI());
    } else {
        Serial.println("\n[Wi-Fi] Falha ao conectar! O ESP32 tentará reconectar no loop.");
    }

    // O relógio sincronizará assim que houver rede, inclusive após uma reconexão.
    configTime(0, 0, "pool.ntp.org", "time.google.com");

    // Serviço paralelo: aguarda Wi-Fi e NTP sem bloquear o controle ou o Firebase.
    initTelegramService();
    Serial.printf("[Telegram] %s\n", telegramConfigured() ? "Configurado" : "Desativado ou sem credenciais");

    // Configurações do Firebase
    Serial.println("[Firebase] Inicializando credenciais...");
    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;

    // Conta exclusiva do dispositivo, criada previamente no Firebase Authentication.
    auth.user.email = DEVICE_EMAIL;
    auth.user.password = DEVICE_PASSWORD;

    config.token_status_callback = tokenStatusCallback;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
}

// ============================================================================
// LOOP PRINCIPAL
// ============================================================================
void loop() {
    const unsigned long agoraMs = millis();

    const bool wifiConectado = WiFi.status() == WL_CONNECTED;
    if (!wifiConectado && !falhaWifiEmAndamento) {
        falhaWifiEmAndamento = true;
        inicioFalhaWifiMs = agoraMs;
    } else if (wifiConectado && falhaWifiEmAndamento) {
        const unsigned long duracaoFalhaMs = agoraMs - inicioFalhaWifiMs;
        falhaWifiEmAndamento = false;
        if (duracaoFalhaMs >= 15000) {
            char aviso[160];
            snprintf(aviso, sizeof(aviso),
                     "📶 Wi-Fi restabelecido\nSem conexão por %lu s · sinal %d dBm",
                     (duracaoFalhaMs + 500UL) / 1000UL, WiFi.RSSI());
            enfileirarAvisoTelegram(AlertTopic::NETWORK, aviso);
        }
    }

    // Reconexão não bloqueante: sensores e fila Telegram continuam funcionando.
    if (WiFi.status() != WL_CONNECTED &&
        (ultimaTentativaWifiMs == 0 || agoraMs - ultimaTentativaWifiMs >= 5000)) {
        ultimaTentativaWifiMs = agoraMs;
        Serial.println("[Wi-Fi] Conexão indisponível. Tentando reconectar...");
        WiFi.reconnect();
    } else if (WiFi.status() == WL_CONNECTED) {
        ultimaTentativaWifiMs = 0;
    }

    // Sincronização de configurações remotas do Firebase a cada 15s ou no boot
    if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
        if (!configSincronizada || (agoraMs - ultimaSincConfigMs >= INTERVALO_CONFIG_SYNC_MS)) {
            ultimaSincConfigMs = agoraMs;
            sincronizarConfiguracaoFirebase();
        }
    }

    // A leitura local independe do Firebase, preservando os alertas durante falhas do banco.
    if (ultimaLeituraMs != 0 && agoraMs - ultimaLeituraMs < INTERVALO_LEITURA_MS) {
        delay(20);
        return;
    }
    ultimaLeituraMs = agoraMs;

    // 1. Leitura dos sensores
    float percentualNivel = lerNivelPercentual();
    bool nivelValido = percentualNivel >= 0;
    if (nivelValido) {
        ultimoNivelValido = percentualNivel;
        possuiNivelValido = true;
    } else {
        percentualNivel = possuiNivelValido ? ultimoNivelValido : 0.0;
    }

    float volumeLitros = (percentualNivel / 100.0) * capacidadeLitros;
    bool statusBomba = digitalRead(PIN_STATUS_BOMBA) == HIGH;
    float correnteA = statusBomba ? lerCorrenteAmperes() : 0.0;
    float potenciaW = TENSAO_REDE_V * correnteA;

    updateTelegramSnapshot(percentualNivel, nivelValido, volumeLitros,
                           statusBomba, correnteA, WiFi.status() == WL_CONNECTED);

    // Telegram recebe transições e resumos; o módulo faz o HTTPS em outra tarefa.
    processarTransicoesTelegram(percentualNivel, nivelValido, statusBomba, correnteA);

    // Mudanças relevantes fora da faixa crítica, no máximo a cada 5 minutos.
    if (nivelValido) {
        if (!telegramProgressoInicializado || percentualNivel <= 20.0 || percentualNivel >= 95.0) {
            telegramUltimoNivelProgresso = percentualNivel;
            telegramProgressoInicializado = true;
        } else if (agoraMs - ultimoProgressoTelegramMs >= INTERVALO_PROGRESSO_TELEGRAM_MS &&
                   fabsf(percentualNivel - telegramUltimoNivelProgresso) >= 10.0f) {
            char progresso[160];
            snprintf(progresso, sizeof(progresso),
                     percentualNivel > telegramUltimoNivelProgresso
                         ? "📈 Nível %.1f%% → %.1f%%\n~%.0f L · Bomba %s"
                         : "📉 Nível %.1f%% → %.1f%%\n~%.0f L · Bomba %s",
                     telegramUltimoNivelProgresso, percentualNivel, volumeLitros,
                     statusBomba ? "ligada" : "desligada");
            enfileirarAvisoTelegram(AlertTopic::LEVEL_PROGRESS, progresso);
            telegramUltimoNivelProgresso = percentualNivel;
            ultimoProgressoTelegramMs = agoraMs;
        }
    }

    if (ultimoResumoTelegramMs == 0) {
        ultimoResumoTelegramMs = agoraMs;
    } else if (agoraMs - ultimoResumoTelegramMs >= INTERVALO_RESUMO_TELEGRAM_MS) {
        ultimoResumoTelegramMs = agoraMs;
        char resumo[160];
        if (nivelValido) {
            snprintf(resumo, sizeof(resumo),
                     "📊 Resumo de 12 h\nNível %.1f%% · ~%.0f L\nBomba %s · %.1f A",
                     percentualNivel, volumeLitros, statusBomba ? "ligada" : "desligada", correnteA);
        } else {
            snprintf(resumo, sizeof(resumo),
                     "📊 Resumo de 12 h\n⚠️ Sensor sem leitura\nBomba %s · %.1f A",
                     statusBomba ? "ligada" : "desligada", correnteA);
        }
        enfileirarAvisoTelegram(AlertTopic::GENERAL, resumo);
    }

    // Mantém exatamente os códigos de alerta já consumidos pelo painel.
    String alerta = "OK";
    if (!nivelValido) {
        alerta = "FALHA_SENSOR_NIVEL";
    } else if (statusBomba && correnteA > 15.0) {
        alerta = "SOBRECARGA_BOMBA";
    } else if (percentualNivel <= 20.0) {
        alerta = "NIVEL_CRITICO_BAIXO";
    } else if (percentualNivel >= 95.0) {
        alerta = "RISCO_TRANSBORDAMENTO";
    }

    // Bomba, sensor, alerta e mudanças >= 1 ponto percentual chegam na próxima
    // amostra; pequenas variações seguem o heartbeat de 4 s. Só atualiza a
    // referência após confirmação do Firebase, preservando tentativas de envio.
    const bool mudancaRelevante = !publicacaoConcluida ||
        nivelValido != ultimoNivelValidoPublicado ||
        statusBomba != ultimaBombaPublicada ||
        alerta != ultimoAlertaPublicado ||
        (nivelValido && fabsf(percentualNivel - ultimoNivelPublicado) >= 1.0f);
    const bool heartbeatVencido = !publicacaoConcluida ||
        agoraMs - ultimaPublicacaoMs >= INTERVALO_HEARTBEAT_MS;
    if (!mudancaRelevante && !heartbeatVencido) return;

    bool timestampValido = false;
    unsigned long long timestampMs = obterTimestampMs(timestampValido);

    // 2. Montagem do payload JSON
    FirebaseJson json;
    json.set("condominio_id", CONDOMINIO_ID);
    json.set("nome", CONDOMINIO_NOME);
    json.set("nivel_percent", round(percentualNivel * 10) / 10.0);
    json.set("nivel_valido", nivelValido);
    json.set("volume_litros", round(volumeLitros));
    json.set("capacidade_total", capacidadeLitros);
    json.set("bomba_ligada", statusBomba);
    json.set("tensao_v", TENSAO_REDE_V);
    json.set("corrente_a", round(correnteA * 100) / 100.0);
    json.set("potencia_w", round(potenciaW));
    json.set("alerta", alerta);
    json.set("rssi_wifi", WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : -127);
    json.set("uptime_segundos", millis() / 1000);
    json.set("timestamp_ms", (double)timestampMs);
    json.set("timestamp_valido", timestampValido);

    // Diagnóstico do Telegram; o frontend atual ignora estes campos extras.
    bool telegramConfigurado = telegramConfigured();
    json.set("telegram_configurado", telegramConfigurado);
    json.set("telegram_conectado", telegramConfigurado && g_telegramLastOK.load());
    json.set("telegram_estado", telegramState());
    json.set("telegram_mensagens_enviadas", (double)g_telegramSent.load());
    json.set("telegram_pendentes", (double)telegramPending());
    json.set("telegram_falhas", (double)g_telegramFailed.load());
    json.set("telegram_consolidados", (double)telegramCoalesced());
    json.set("telegram_ultimo_envio_ok", g_telegramLastOK.load());

    // 3. Gravação permanece no mesmo nó e só ocorre quando o Firebase está pronto.
    if (WiFi.status() == WL_CONNECTED && Firebase.ready()) {
        String caminho = "/condominios/" + String(CONDOMINIO_ID) + "/telemetria";
        Serial.printf("[Firebase] Enviando dados para: %s ... ", caminho.c_str());

        if (Firebase.RTDB.updateNode(&fbdo, caminho.c_str(), &json)) {
            publicacaoConcluida = true;
            ultimaPublicacaoMs = millis();
            ultimoNivelPublicado = percentualNivel;
            ultimoNivelValidoPublicado = nivelValido;
            ultimaBombaPublicada = statusBomba;
            ultimoAlertaPublicado = alerta;
            Serial.println("SUCESSO!");
            Serial.printf("   > Nível: %.1f%% (%.0f L) | Bomba: %s | Potência: %.0f W\n",
                          percentualNivel, volumeLitros, statusBomba ? "LIGADA" : "DESLIGADA", potenciaW);

            // Histórico é opcional e separado: uma falha de permissão ou gravação
            // nunca altera a telemetria ao vivo nem a leitura dos sensores.
            if (timestampValido) {
                const unsigned long long bucket = timestampMs / INTERVALO_HISTORICO_MS;
                if (bucket != ultimoBucketHistoricoPublicado &&
                    (ultimaTentativaHistoricoMs == 0 ||
                     millis() - ultimaTentativaHistoricoMs >= INTERVALO_RETENTATIVA_HISTORICO_MS)) {
                    ultimaTentativaHistoricoMs = millis();
                    FirebaseJson amostra;
                    amostra.set("timestamp_ms", (double)timestampMs);
                    amostra.set("nivel_percent", round(percentualNivel * 10) / 10.0);
                    amostra.set("nivel_valido", nivelValido);
                    amostra.set("bomba_ligada", statusBomba);
                    amostra.set("corrente_a", round(correnteA * 100) / 100.0);
                    amostra.set("alerta", alerta);
                    amostra.set("dispositivo_id", "esp32_principal");
                    const String caminhoAmostra = "/condominios/" + String(CONDOMINIO_ID) +
                        "/historico/amostras/" + String((unsigned long)bucket);
                    if (Firebase.RTDB.setJSON(&fbdo, caminhoAmostra.c_str(), &amostra)) {
                        ultimoBucketHistoricoPublicado = bucket;
                    } else {
                        Serial.printf("[Historico] Amostra nao salva: %s\n", fbdo.errorReason().c_str());
                    }
                }
            }
        } else {
            Serial.print("FALHA! Motivo: ");
            Serial.println(fbdo.errorReason());
        }
    }
}
