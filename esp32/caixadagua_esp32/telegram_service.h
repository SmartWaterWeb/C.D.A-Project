#pragma once

#include <Arduino.h>
#include <atomic>
#include "secrets.h"

#ifndef ENABLE_TELEGRAM
#define ENABLE_TELEGRAM 0
#endif

#ifndef TELEGRAM_BOT_TOKEN
#define TELEGRAM_BOT_TOKEN ""
#endif

#ifndef TELEGRAM_CHAT_ID
#define TELEGRAM_CHAT_ID ""
#endif

#ifndef TELEGRAM_SIMULATED_MODE
#define TELEGRAM_SIMULATED_MODE false
#endif

enum class AlertTopic : uint8_t {
    TEST,
    GENERAL,
    BOOT,
    MODE,
    PUMP,
    NETWORK,
    LEVEL,
    POWER,
    SENSOR,
    FAULT,
    COUNT
};

extern std::atomic<uint32_t> g_telegramSent;
extern std::atomic<uint32_t> g_telegramFailed;
extern std::atomic<bool> g_telegramBusy;
extern std::atomic<bool> g_telegramLastOK;

bool telegramConfigured();
bool enqueueTelegramAlert(const char* message, AlertTopic topic = AlertTopic::GENERAL);
const char* telegramState();
void initTelegramService();
uint32_t telegramPending();
uint32_t telegramCoalesced();
