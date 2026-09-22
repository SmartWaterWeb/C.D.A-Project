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
#include <time.h>
#include "telegram_ca.h"

struct PendingAlert {
    char text[256]{};
    uint32_t occurredAt = 0;
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
    item.occurredAt = now / 1000;
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
    if (length <= 0 || static_cast<size_t>(length) >= capacity) return false;

    auto* stream = http.getStreamPtr();
    const uint32_t start = millis();
    size_t used = 0;
    while (used < static_cast<size_t>(length) && static_cast<uint32_t>(millis() - start) < 5000) {
        const int available = stream->available();
        if (available > 0) {
            const size_t remaining = static_cast<size_t>(length) - used;
            const size_t chunk = min(static_cast<size_t>(available), remaining);
            const int read = stream->readBytes(data + used, chunk);
            if (read > 0) used += static_cast<size_t>(read);
        } else if (!http.connected()) {
            break;
        } else {
            vTaskDelay(pdMS_TO_TICKS(10));
        }
    }

    data[used] = 0;
    return used == static_cast<size_t>(length);
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
        for (int i = static_cast<int>(AlertTopic::COUNT) - 1; i >= 0; --i) {
            if (slots[i].pending && slots[i].due == 0) {
                selected = i;
                item = slots[i];
                break;
            }
        }
        portEXIT_CRITICAL(&alertMux);

        if (selected < 0) {
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
                StaticJsonDocument<768> payload;
#endif
                char message[384];
                telegram_policy::formatMessage(
                    message,
                    sizeof(message),
                    item.text,
                    TELEGRAM_SIMULATED_MODE,
                    selected == static_cast<int>(AlertTopic::TEST),
                    item.occurredAt,
                    item.merged
                );

                payload["chat_id"] = TELEGRAM_CHAT_ID;
                payload["text"] = message;

                char body[1024];
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
            (selected == static_cast<int>(AlertTopic::TEST) || selected == static_cast<int>(AlertTopic::LEVEL))
                ? 60000
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

#endif
