#pragma once

// O hook deve permanecer curto e seguro entre tarefas. O firmware principal
// publica os contadores no Firebase; nenhuma chamada de rede deve ocorrer aqui.
#ifndef TELEGRAM_RECORD_EVENT
#define TELEGRAM_RECORD_EVENT(type, message, status) \
    do {                                              \
        (void)(type);                                 \
        (void)(message);                              \
        (void)(status);                               \
    } while (0)
#endif
