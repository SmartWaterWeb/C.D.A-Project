# 02 - Agente de Firmware (ESP32)

Este diretório contém o firmware operacional oficial do sistema e a biblioteca de referência de módulos avançados de proteção.

---

## 📂 Estrutura de Arquivos

```
02_agente_firmware/
└── caixadagua_esp32/                   <-- PASTA PRINCIPAL DO FIRMWARE (Abrir na Arduino IDE)
    ├── caixadagua_esp32.ino            # Sketch principal com Firebase Realtime Database
    ├── partitions.csv                  # Layout Huge APP (3 MB) para suporte a TLS e Firebase
    ├── secrets.h.example               # Modelo limpo para configurar credenciais locais
    ├── telegram_service.cpp / .h       # Bot interativo FreeRTOS com botões inline
    ├── telegram_policy.h / hooks.h     # Políticas de rate-limit e resumos periódicos
    └── telegram_ca.h                   # Certificado raiz CA da API do Telegram

Nota: Módulos de referência de bancada e lógicas avançadas (bomba dupla, cavitação, buzzer)
estão preservados localmente em `_backup_reserva/referencias_modulos_avancados/`.
```

---

## 🚀 Como Compilar e Gravar o ESP32

1. Abra a pasta `02_agente_firmware/caixadagua_esp32/caixadagua_esp32.ino` na **Arduino IDE** (ou abra `esp32/caixadagua_esp32/caixadagua_esp32.ino` que está sincronizada).
2. Certifique-se de que possui as bibliotecas instaladas no Gerenciador de Bibliotecas da Arduino IDE:
   - **`Firebase ESP Client`** por *Mobizt* (v4.x.x ou superior)
   - **`ArduinoJson`** por *Benoit Blanchon* (**v6.21.5**)
3. Configure a placa na Arduino IDE:
   - **Placa**: `ESP32 Dev Module`
   - **Upload Speed**: `115200` (ou `921600` para gravação rápida)
   - **Flash Size**: `4MB (32Mb)`
   - **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **Flash Mode**: `DIO`
4. Conecte o ESP32 via cabo USB e selecione a porta COM.
5. Clique em **Carregar (Upload)** e acompanhe o Monitor Serial (115200 baud).

---

## 🔁 Como Configurar para um Novo / Segundo ESP32

Para adicionar uma nova placa (ex: segundo reservatório ou novo condomínio):
1. No arquivo `caixadagua_esp32.ino`:
   ```cpp
   const char* CONDOMINIO_ID = "condominio_beta"; // ID exclusivo sem espaços
   const char* CONDOMINIO_NOME = "Residencial Flores - Bloco B";
   ```
2. No arquivo `secrets.h`:
   - Preencha o `WIFI_SSID` e `WIFI_PASSWORD` da rede local daquele condomínio.
   - Configure o e-mail/senha da conta exclusiva criada no Firebase Authentication (`DEVICE_EMAIL` e `DEVICE_PASSWORD`).
   - Se desejar alertas em grupo exclusivo do Telegram, informe o `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` daquele grupo.
3. Grave o ESP32. Ele passará a transmitir automaticamente para o nó `/condominios/condominio_beta/` no Firebase RTDB.
