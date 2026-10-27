#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace telegram_policy {

inline bool credentialsValid(const char* token, const char* chat) {
    if (!token || !chat) return false;

    const size_t tokenLength = strlen(token);
    const size_t chatLength = strlen(chat);
    if (tokenLength < 21 || tokenLength > 120 || chatLength == 0 || chatLength > 21) return false;

    size_t colon = 0;
    while (colon < tokenLength && token[colon] >= '0' && token[colon] <= '9') ++colon;
    if (colon == 0 || colon >= tokenLength - 1 || token[colon] != ':') return false;

    for (size_t i = colon + 1; i < tokenLength; ++i) {
        const char c = token[i];
        if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
              (c >= '0' && c <= '9') || c == '_' || c == '-')) {
            return false;
        }
    }

    size_t i = chat[0] == '-' ? 1 : 0;
    if (i == chatLength) return false;
    for (; i < chatLength; ++i) {
        if (chat[i] < '0' || chat[i] > '9') return false;
    }
    return true;
}

inline bool formatMessage(char* output, size_t capacity, const char* message,
                          bool simulated, bool test, uint32_t delaySeconds, uint32_t merged) {
    if (!output || capacity == 0 || !message || !*message || strlen(message) >= 256) return false;

    const char* prefix = simulated ? "[TESTE SEM SENSORES] " : test ? "[TESTE] " : "";
    int length = snprintf(output, capacity, "%s%s", prefix, message);
    if (length < 0 || static_cast<size_t>(length) >= capacity) return false;

    if (delaySeconds >= 60) {
        const int added = snprintf(output + length, capacity - length,
                                   "\n⏱️ Registrado há %lu min",
                                   static_cast<unsigned long>(delaySeconds / 60));
        if (added < 0 || static_cast<size_t>(added) >= capacity - length) return false;
        length += added;
    }
    if (merged > 0) {
        const int added = snprintf(output + length, capacity - length,
                                   "\n+%lu mudanças agrupadas",
                                   static_cast<unsigned long>(merged));
        if (added < 0 || static_cast<size_t>(added) >= capacity - length) return false;
    }
    return true;
}

inline uint32_t retryAfterMs(uint32_t seconds) {
    return seconds ? (seconds > 86400 ? 86400 : seconds) * 1000U : 60000U;
}

}  // namespace telegram_policy
