#include "telegram_service.h"
#include "telegram_hooks.h"
#include "telegram_policy.h"
#include <WiFi.h>

std::atomic<uint32_t> g_telegramSent{0};
std::atomic<uint32_t> g_telegramFailed{0};
std::atomic<bool> g_telegramBusy{false};
std::atomic<bool> g_telegramLastOK{false};

#if ENABLE_TELEGRAM

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <time.h>
#include "telegram_ca.h"

struct PendingAlert {
    char text[256]{};
    uint32_t occurredAtMs = 0;
    uint32_t version = 0;
    uint32_t due = 0;
    uint32_t retryMs = 5000;
    uint32_t merged = 0;
    bool pending = false;
};

static PendingAlert slots[static_cast<uint8_t>(AlertTopic::COUNT)];
static portMUX_TYPE alertMux = portMUX_INITIALIZER_UNLOCKED;
static std::atomic<bool> ready{false};
static uint32_t mergedTotal = 0;
static uint32_t lastTest = 0;
static bool tested = false;
static uint32_t nextUpdateOffset = 0;
static uint32_t nextCommandPoll = 0;
static uint32_t lastCommandErrorLog = 0;
static uint32_t nextMenuSetup = 0;
static bool menuRegistered = false;
static constexpr uint32_t COMMAND_POLL_INTERVAL_MS = 1200;
static constexpr uint32_t COMMAND_POLL_RETRY_MS = 5000;

struct TelegramSnapshot {
    float level = 0;
    float volume = 0;
    float current = 0;
    uint32_t measuredAt = 0;
    bool levelValid = false;
    bool pumpOn = false;
    bool wifiConnected = false;
    bool available = false;
};

static TelegramSnapshot snapshot;
static portMUX_TYPE snapshotMux = portMUX_INITIALIZER_UNLOCKED;

void updateTelegramSnapshot(float levelPercent, bool levelValid, float volumeLiters,
                            bool pumpOn, float currentA, bool wifiConnected) {
    portENTER_CRITICAL(&snapshotMux);
    snapshot = {levelPercent, volumeLiters, currentA, millis(), levelValid,
                pumpOn, wifiConnected, true};
    portEXIT_CRITICAL(&snapshotMux);
}

bool telegramConfigured() {
    return telegram_policy::credentialsValid(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID);
}

bool enqueueTelegramAlert(const char* message, AlertTopic topic) {
    if (!telegramConfigured() || !message || !*message || strlen(message) >= 256 ||
        static_cast<uint8_t>(topic) >= static_cast<uint8_t>(AlertTopic::COUNT)) {
        g_telegramFailed++;
        return false;
    }

    const uint32_t now = millis();
    portENTER_CRITICAL(&alertMux);

    if (topic == AlertTopic::TEST && tested && static_cast<uint32_t>(now - lastTest) < 60000) {
        portEXIT_CRITICAL(&alertMux);
        return false;
    }
    if (topic == AlertTopic::TEST) {
        tested = true;
        lastTest = now;
    }

    auto& item = slots[static_cast<uint8_t>(topic)];
    if (item.pending) {
        item.merged++;
        mergedTotal++;
    }
    if (!item.pending && static_cast<int32_t>(now - item.due) >= 0) item.due = 0;

    snprintf(item.text, sizeof(item.text), "%s", message);
    item.version++;
    item.occurredAtMs = now;
    item.pending = true;

    portEXIT_CRITICAL(&alertMux);
    return true;
}

uint32_t telegramPending() {
    uint32_t count = 0;
    portENTER_CRITICAL(&alertMux);
    for (const auto& slot : slots) {
        if (slot.pending) count++;
    }
    portEXIT_CRITICAL(&alertMux);
    return count;
}

uint32_t telegramCoalesced() {
    portENTER_CRITICAL(&alertMux);
    const uint32_t count = mergedTotal;
    portEXIT_CRITICAL(&alertMux);
    return count;
}

const char* telegramState() {
    if (!telegramConfigured()) return "Desativado";
    if (!ready) return "Indisponivel";
    if (WiFi.status() != WL_CONNECTED) return "Aguardando rede";
    if (time(nullptr) < 1700000000) return "Aguardando horario";
    if (g_telegramBusy) return "Processando fila";
    if (!g_telegramLastOK && g_telegramFailed) return "Falha no envio; nova tentativa pendente";
    return g_telegramLastOK ? "Ultimo envio confirmado" : "Aguardando envio";
}

static bool responseBody(HTTPClient& http, char* data, size_t capacity) {
    const int length = http.getSize();
    if (length == 0 || (length > 0 && static_cast<size_t>(length) >= capacity)) return false;

    auto* stream = http.getStreamPtr();
    const uint32_t start = millis();
    size_t used = 0;
    while ((length < 0 || used < static_cast<size_t>(length)) &&
           static_cast<uint32_t>(millis() - start) < 5000) {
        const int available = stream->available();
        if (available > 0) {
            const size_t remaining = capacity - used - 1;
            if (remaining == 0) return false;
            const size_t chunk = min(static_cast<size_t>(available),
                                     length < 0 ? remaining : min(remaining, static_cast<size_t>(length) - used));
            const int read = stream->readBytes(data + used, chunk);
            if (read > 0) used += static_cast<size_t>(read);
        } else if (!http.connected()) {
            break;
        } else {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
    }

    data[used] = 0;
    return length < 0 ? used > 0 && !http.connected() : used == static_cast<size_t>(length);
}

static void answerButtonPress(const char* callbackId, bool authorized) {
    if (!callbackId || !*callbackId) return;

    WiFiClientSecure tls;
    tls.setCACert(TELEGRAM_ROOT_CA);
    tls.setHandshakeTimeout(5);
    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(3500);

    char url[180];
    snprintf(url, sizeof(url), "https://api.telegram.org/bot%s/answerCallbackQuery", TELEGRAM_BOT_TOKEN);
    if (!http.begin(tls, url)) return;
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument payload;
#else
    StaticJsonDocument<256> payload;
#endif
    payload["callback_query_id"] = callbackId;
    if (!authorized) payload["text"] = "Este chat não está autorizado.";
    char body[256];
    const size_t length = serializeJson(payload, body, sizeof(body));
    if (!payload.overflowed() && measureJson(payload) == length && length < sizeof(body)) {
        http.addHeader("Content-Type", "application/json");
        http.POST(reinterpret_cast<uint8_t*>(body), length);
    }
    http.end();
}

static bool registerCommandMenu() {
    WiFiClientSecure tls;
    tls.setCACert(TELEGRAM_ROOT_CA);
    tls.setHandshakeTimeout(5);
    HTTPClient http;
    http.setConnectTimeout(3000);
    http.setTimeout(3500);

    char url[180];
    snprintf(url, sizeof(url), "https://api.telegram.org/bot%s/setMyCommands", TELEGRAM_BOT_TOKEN);
    if (!http.begin(tls, url)) return false;
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument payload;
#else
    StaticJsonDocument<1024> payload;
#endif
    JsonObject scope = payload["scope"].to<JsonObject>();
    scope["type"] = "chat";
    scope["chat_id"] = TELEGRAM_CHAT_ID;
    JsonArray commands = payload["commands"].to<JsonArray>();
    JsonObject status = commands.createNestedObject();
    status["command"] = "status";
    status["description"] = "Resumo da caixa";
    JsonObject level = commands.createNestedObject();
    level["command"] = "nivel";
    level["description"] = "Nível e volume";
    JsonObject pump = commands.createNestedObject();
    pump["command"] = "bomba";
    pump["description"] = "Estado e corrente";
    JsonObject system = commands.createNestedObject();
    system["command"] = "sistema";
    system["description"] = "Sensor e conexão";
    JsonObject help = commands.createNestedObject();
    help["command"] = "ajuda";
    help["description"] = "Ver opções do bot";

    char body[768];
    const size_t length = serializeJson(payload, body, sizeof(body));
    bool registered = false;
    if (!payload.overflowed() && measureJson(payload) == length && length < sizeof(body)) {
        http.addHeader("Content-Type", "application/json");
        const int code = http.POST(reinterpret_cast<uint8_t*>(body), length);
        if (code == 200) {
            char responseText[256];
#if ARDUINOJSON_VERSION_MAJOR >= 7
            JsonDocument response;
#else
            StaticJsonDocument<256> response;
#endif
            registered = responseBody(http, responseText, sizeof(responseText)) &&
                         !deserializeJson(response, responseText) && response["ok"] == true;
        }
    }
    http.end();
    return registered;
}

static void handleCommand(const char* command) {
    if (!command || command[0] != '/') return;

    char answer[256];
    TelegramSnapshot current;
    portENTER_CRITICAL(&snapshotMux);
    current = snapshot;
    portEXIT_CRITICAL(&snapshotMux);
    const unsigned long ageSeconds = current.available
        ? static_cast<unsigned long>((millis() - current.measuredAt) / 1000U) : 0;

    if (strncmp(command, "/status", 7) == 0 &&
        (command[7] == 0 || command[7] == ' ' || command[7] == '@')) {
        if (!current.available) {
            snprintf(answer, sizeof(answer), "⏳ Aguardando a primeira leitura. Tente de novo em alguns segundos.");
        } else if (current.levelValid) {
            snprintf(answer, sizeof(answer),
                     "📊 Resumo\n💧 %.1f%% · ~%.0f L\n⚙️ Bomba %s · %.1f A\nLeitura há %lu s%s",
                     current.level, current.volume, current.pumpOn ? "ligada" : "desligada",
                     current.current, ageSeconds, ageSeconds > 10 ? " ⚠️" : "");
        } else {
            snprintf(answer, sizeof(answer),
                     "⚠️ Sensor sem leitura\nBomba %s · %.1f A\nLeitura há %lu s",
                     current.pumpOn ? "ligada" : "desligada", current.current, ageSeconds);
        }
    } else if (strncmp(command, "/nivel", 6) == 0 &&
               (command[6] == 0 || command[6] == ' ' || command[6] == '@')) {
        if (!current.available) {
            snprintf(answer, sizeof(answer), "⏳ Aguardando a primeira leitura do nível.");
        } else if (current.levelValid) {
            snprintf(answer, sizeof(answer),
                     "💧 Nível: %.1f%%\nVolume estimado: %.0f L\nLeitura há %lu s%s",
                     current.level, current.volume, ageSeconds, ageSeconds > 10 ? " ⚠️" : "");
        } else {
            snprintf(answer, sizeof(answer),
                     "⚠️ Sensor sem leitura\nNível atual não confirmado\nLeitura há %lu s",
                     ageSeconds);
        }
    } else if (strncmp(command, "/bomba", 6) == 0 &&
               (command[6] == 0 || command[6] == ' ' || command[6] == '@')) {
        if (current.available) {
            snprintf(answer, sizeof(answer), "⚙️ Bomba %s\nCorrente: %.1f A\nLeitura há %lu s%s",
                     current.pumpOn ? "ligada" : "desligada", current.current,
                     ageSeconds, ageSeconds > 10 ? " ⚠️" : "");
        } else {
            snprintf(answer, sizeof(answer), "⏳ Ainda não há leitura da bomba.");
        }
    } else if (strncmp(command, "/sistema", 8) == 0 &&
               (command[8] == 0 || command[8] == ' ' || command[8] == '@')) {
        if (current.available) {
            snprintf(answer, sizeof(answer),
                     "🩺 Sistema\nSensor: %s\nWi-Fi: %s (%d dBm)\nLeitura há %lu s%s",
                     current.levelValid ? "normal" : "sem leitura",
                     current.wifiConnected ? "conectado" : "sem conexão",
                     current.wifiConnected ? WiFi.RSSI() : -127,
                     ageSeconds, ageSeconds > 10 ? " ⚠️" : "");
        } else {
            snprintf(answer, sizeof(answer), "⏳ Sistema iniciado. Aguardando a primeira leitura.");
        }
    } else if (strncmp(command, "/ajuda", 6) == 0 || strncmp(command, "/start", 6) == 0) {
        snprintf(answer, sizeof(answer),
                 "Toque em uma opção abaixo para consultar.\nOs avisos urgentes chegam automaticamente.\nEste bot não aciona a bomba.");
    } else {
        snprintf(answer, sizeof(answer), "Comando não reconhecido. Use /ajuda para ver as opções.");
    }

    enqueueTelegramAlert(answer, AlertTopic::COMMAND);
}

static void pollCommands() {
    char callbackId[128] = {};
    const char* buttonCommand = nullptr;
    bool buttonAuthorized = false;
    WiFiClientSecure tls;
    tls.setCACert(TELEGRAM_ROOT_CA);
    tls.setHandshakeTimeout(5);
    HTTPClient http;
    http.useHTTP10(true);
    http.setConnectTimeout(3000);
    http.setTimeout(3500);

    char url[256];
    snprintf(url, sizeof(url),
             "https://api.telegram.org/bot%s/getUpdates?offset=%lu&limit=1&timeout=1&allowed_updates=%%5B%%22message%%22%%2C%%22callback_query%%22%%5D",
             TELEGRAM_BOT_TOKEN, static_cast<unsigned long>(nextUpdateOffset));
    if (!http.begin(tls, url)) {
        nextCommandPoll = millis() + COMMAND_POLL_RETRY_MS;
        return;
    }
    const int code = http.GET();
    if (code == 200) {
        char responseText[3072];
#if ARDUINOJSON_VERSION_MAJOR >= 7
        JsonDocument response;
#else
        StaticJsonDocument<3072> response;
#endif
        if (responseBody(http, responseText, sizeof(responseText)) &&
            !deserializeJson(response, responseText) && response["ok"] == true) {
            JsonArray updates = response["result"].as<JsonArray>();
            if (!updates.isNull() && updates.size() > 0) {
                JsonObject update = updates[0];
                const uint32_t updateId = update["update_id"] | 0U;
                if (updateId >= nextUpdateOffset) {
                    nextUpdateOffset = updateId + 1U;
                    Preferences preferences;
                    if (preferences.begin("tgcmd", false)) {
                        preferences.putULong("offset", nextUpdateOffset);
                        preferences.end();
                    }
                    JsonObject message = update["message"].as<JsonObject>();
                    if (!message.isNull()) {
                        const int64_t chatId = message["chat"]["id"] | static_cast<int64_t>(0);
                        const char* command = message["text"] | "";
                        const uint32_t sentAt = message["date"] | 0U;
                        const time_t now = time(nullptr);
                        char chatIdText[24];
                        snprintf(chatIdText, sizeof(chatIdText), "%lld", static_cast<long long>(chatId));
                        if (strcmp(chatIdText, TELEGRAM_CHAT_ID) == 0 && command[0] == '/' &&
                            sentAt > 0 && now >= static_cast<time_t>(sentAt) &&
                            now - static_cast<time_t>(sentAt) <= 300) {
                            handleCommand(command);
                        }
                    }
                    JsonObject callback = update["callback_query"].as<JsonObject>();
                    if (!callback.isNull()) {
                        const char* id = callback["id"] | "";
                        if (strlen(id) < sizeof(callbackId)) {
                            snprintf(callbackId, sizeof(callbackId), "%s", id);
                            const int64_t chatId = callback["message"]["chat"]["id"] | static_cast<int64_t>(0);
                            char chatIdText[24];
                            snprintf(chatIdText, sizeof(chatIdText), "%lld", static_cast<long long>(chatId));
                            buttonAuthorized = strcmp(chatIdText, TELEGRAM_CHAT_ID) == 0;
                            const char* action = callback["data"] | "";
                            if (buttonAuthorized) {
                                if (strcmp(action, "status") == 0) buttonCommand = "/status";
                                else if (strcmp(action, "nivel") == 0) buttonCommand = "/nivel";
                                else if (strcmp(action, "bomba") == 0) buttonCommand = "/bomba";
                                else if (strcmp(action, "sistema") == 0) buttonCommand = "/sistema";
                                else if (strcmp(action, "ajuda") == 0) buttonCommand = "/ajuda";
                            }
                        }
                    }
                }
            }
        }
    } else if (code == 409 || code == 401 || code == 403) {
        const uint32_t nowMs = millis();
        if (!lastCommandErrorLog || nowMs - lastCommandErrorLog >= 60000) {
            Serial.printf("[Telegram] Comandos indisponiveis (HTTP %d). Verifique token exclusivo e webhook.\n", code);
            lastCommandErrorLog = nowMs;
        }
        nextCommandPoll = nowMs + 60000;
    } else if (code != 200) {
        // Falhas temporárias não devem causar tentativas HTTPS em sequência.
        nextCommandPoll = millis() + (code == 429 ? 30000 : COMMAND_POLL_RETRY_MS);
    }
    http.end();
    if (callbackId[0]) {
        answerButtonPress(callbackId, buttonAuthorized);
        if (buttonCommand) handleCommand(buttonCommand);
    }
}

static void telegramWorker(void*) {
    uint32_t globalDue = 0;

    for (;;) {
        const uint32_t now = millis();
        if (globalDue && static_cast<int32_t>(now - globalDue) >= 0) globalDue = 0;

        if (WiFi.status() != WL_CONNECTED || time(nullptr) < 1700000000 || globalDue) {
            vTaskDelay(pdMS_TO_TICKS(250));
            continue;
        }

        PendingAlert item;
        int selected = -1;
        portENTER_CRITICAL(&alertMux);
        for (auto& slot : slots) {
            if (slot.due && static_cast<int32_t>(now - slot.due) >= 0) slot.due = 0;
        }
        // Consultas nunca passam à frente de alertas operacionais pendentes.
        for (int i = static_cast<int>(AlertTopic::FAULT); i >= 0; --i) {
            if (slots[i].pending && slots[i].due == 0) {
                selected = i;
                item = slots[i];
                break;
            }
        }
        if (selected < 0) {
            auto& command = slots[static_cast<uint8_t>(AlertTopic::COMMAND)];
            if (command.pending && command.due == 0) {
                selected = static_cast<int>(AlertTopic::COMMAND);
                item = command;
            }
        }
        portEXIT_CRITICAL(&alertMux);

        if (selected < 0) {
            if (!nextCommandPoll || static_cast<int32_t>(now - nextCommandPoll) >= 0) {
                // A chamada já espera até 1 s por um toque; a pausa adicional
                // curta melhora o tempo de resposta sem prolongar o bloqueio
                // dos alertas operacionais.
                nextCommandPoll = now + COMMAND_POLL_INTERVAL_MS;
                pollCommands();
            }
            // Registrar o menu é opcional; nunca atrasa uma resposta ou alerta
            // recebido enquanto a consulta ao Telegram estava em andamento.
            if (!menuRegistered && telegramPending() == 0 &&
                (!nextMenuSetup || static_cast<int32_t>(millis() - nextMenuSetup) >= 0)) {
                menuRegistered = registerCommandMenu();
                nextMenuSetup = millis() + 300000;
            }
            vTaskDelay(pdMS_TO_TICKS(250));
            continue;
        }

        g_telegramBusy = true;
        int code = -1;
        bool delivered = false;
        uint32_t requestedDelay = 0;

        {
            WiFiClientSecure tls;
            tls.setCACert(TELEGRAM_ROOT_CA);
            tls.setHandshakeTimeout(8);

            HTTPClient http;
            http.useHTTP10(true);
            http.setConnectTimeout(5000);
            http.setTimeout(5000);

            char url[180];
            snprintf(url, sizeof(url), "https://api.telegram.org/bot%s/sendMessage", TELEGRAM_BOT_TOKEN);

            if (http.begin(tls, url)) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
                JsonDocument payload;
#else
                StaticJsonDocument<1024> payload;
#endif
                char message[384];
                telegram_policy::formatMessage(
                    message,
                    sizeof(message),
                    item.text,
                    TELEGRAM_SIMULATED_MODE,
                    selected == static_cast<int>(AlertTopic::TEST),
                    static_cast<uint32_t>(millis() - item.occurredAtMs) / 1000U,
                    item.merged
                );

                payload["chat_id"] = TELEGRAM_CHAT_ID;
                payload["text"] = message;
                if (selected == static_cast<int>(AlertTopic::COMMAND)) {
                    JsonObject markup = payload["reply_markup"].to<JsonObject>();
                    JsonArray rows = markup["inline_keyboard"].to<JsonArray>();
                    JsonArray firstRow = rows.createNestedArray();
                    JsonObject statusButton = firstRow.createNestedObject();
                    statusButton["text"] = "📊 Resumo";
                    statusButton["callback_data"] = "status";
                    JsonObject levelButton = firstRow.createNestedObject();
                    levelButton["text"] = "💧 Nível";
                    levelButton["callback_data"] = "nivel";
                    JsonArray secondRow = rows.createNestedArray();
                    JsonObject pumpButton = secondRow.createNestedObject();
                    pumpButton["text"] = "⚙️ Bomba";
                    pumpButton["callback_data"] = "bomba";
                    JsonObject systemButton = secondRow.createNestedObject();
                    systemButton["text"] = "🩺 Sistema";
                    systemButton["callback_data"] = "sistema";
                } else if (selected == static_cast<int>(AlertTopic::LEVEL) ||
                           selected == static_cast<int>(AlertTopic::SENSOR) ||
                           selected == static_cast<int>(AlertTopic::FAULT) ||
                           selected == static_cast<int>(AlertTopic::POWER) ||
                           selected == static_cast<int>(AlertTopic::PUMP) ||
                           selected == static_cast<int>(AlertTopic::NETWORK) ||
                           selected == static_cast<int>(AlertTopic::BOOT)) {
                    JsonObject markup = payload["reply_markup"].to<JsonObject>();
                    JsonArray rows = markup["inline_keyboard"].to<JsonArray>();
                    JsonArray row = rows.createNestedArray();
                    JsonObject statusButton = row.createNestedObject();
                    statusButton["text"] = "📊 Ver situação atual";
                    statusButton["callback_data"] = "status";
                }

                char body[1280];
                const size_t length = serializeJson(payload, body, sizeof(body));
                http.addHeader("Content-Type", "application/json");
                if (!payload.overflowed() && measureJson(payload) == length && length < sizeof(body)) {
                    code = http.POST(reinterpret_cast<uint8_t*>(body), length);
                }

                if (code == 200 || code == 429) {
                    char responseText[1536];
#if ARDUINOJSON_VERSION_MAJOR >= 7
                    JsonDocument response;
#else
                    StaticJsonDocument<2048> response;
#endif
                    if (responseBody(http, responseText, sizeof(responseText)) &&
                        !deserializeJson(response, responseText)) {
                        delivered = code == 200 && response["ok"] == true;
                        if (code == 429) requestedDelay = response["parameters"]["retry_after"] | 0U;
                    }
                }
                http.end();
            }
        }

        const uint32_t finished = millis();
        const bool permanent = code == 400 || code == 401 || code == 403 || code == 404;
        const uint32_t successCooldown =
            selected == static_cast<int>(AlertTopic::TEST) ? 60000
            : selected == static_cast<int>(AlertTopic::LEVEL_PROGRESS) ? 300000
            : 1500;

        uint32_t waitMs = delivered ? successCooldown : permanent ? 300000 : item.retryMs;
        if (code == 429) waitMs = telegram_policy::retryAfterMs(requestedDelay);
        globalDue = finished + (code == 429 ? waitMs : 1500);

        portENTER_CRITICAL(&alertMux);
        auto& current = slots[selected];
        if (current.version == item.version && delivered) {
            current.pending = false;
            current.merged = 0;
        }
        current.due = finished + waitMs;
        current.retryMs = delivered ? 5000 : min<uint32_t>(item.retryMs * 2, 60000);
        portEXIT_CRITICAL(&alertMux);

        g_telegramLastOK = delivered;
        if (delivered) {
            g_telegramSent++;
            TELEGRAM_RECORD_EVENT("TELEGRAM", "Mensagem aceita pelo Telegram.", "OK");
        } else {
            g_telegramFailed++;
            if (item.retryMs == 5000 || permanent) {
                TELEGRAM_RECORD_EVENT("TELEGRAM", "Envio falhou; alerta mantido para nova tentativa.", "ERRO");
            }
        }
        g_telegramBusy = false;
    }
}

void initTelegramService() {
    if (!telegramConfigured() || ready) return;
    Preferences preferences;
    if (preferences.begin("tgcmd", true)) {
        nextUpdateOffset = preferences.getULong("offset", 0);
        preferences.end();
    }
    ready = xTaskCreatePinnedToCore(telegramWorker, "telegram", 12288, nullptr, 1, nullptr, 0) == pdPASS;
    if (!ready) {
        g_telegramFailed++;
        TELEGRAM_RECORD_EVENT("TELEGRAM", "Worker indisponivel; alertas retidos em RAM.", "ERRO");
    }
}

#else

bool telegramConfigured() { return false; }
bool enqueueTelegramAlert(const char*, AlertTopic) { return false; }
const char* telegramState() { return "Desativado"; }
void initTelegramService() {}
uint32_t telegramPending() { return 0; }
uint32_t telegramCoalesced() { return 0; }
void updateTelegramSnapshot(float, bool, float, bool, float, bool) {}

#endif
