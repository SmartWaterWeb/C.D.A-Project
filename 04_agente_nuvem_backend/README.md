# 04 - Agente Nuvem e Backend (Firebase Multi-Tenant & DevOps)

Este diretório concentra a inteligência de nuvem, segurança do banco de dados, regras de acesso e utilitários DevOps do **SmartWater**.

---

## ☁️ Arquitetura de Nuvem

O sistema utiliza o **Google Firebase Realtime Database (RTDB)** como broker de mensagens e armazenamento em tempo real:
- **Latência Baixa**: Conexão WebSocket bidirecional contínua entre o painel web e a nuvem.
- **Isolamento de Segurança**: Cada condomínio possui nó próprio (`/condominios/<id>/`).
- **Autenticação Baseada em Regras (`firebase.rules.json`)**:
  - As permissões são indexadas por `UID` no nó raiz `/access/<uid>/<condominio_id>`.
  - Dispositivos ESP32 possuem `"write": true` para publicar telemetria e amostras históricas apenas no seu condomínio.
  - Síndicos e operadores possuem `"read": true` para leitura em tempo real, consulta de histórico e ajuste de calibração em `/condominios/<id>/config`.
  - Administradores possuem múltiplos condomínios listados sob `/access/<admin_uid>/`, habilitando automaticamente o seletor multi-condomínio no painel web.

---

## 📄 Arquivos de Regras e Acesso

- `firebase.rules.json`: Regras de segurança completas para publicar no Firebase Console.
- `firebase.access.example.json`: Modelo exato da estrutura `/access/<uid>/<condominio_id>`.
- `GUIA_ADICIONAR_NOVO_ESP32.md`: Manual operacional completo para **Operador de Campo**, **Cliente (Síndico/PWA/Telegram)** e **Admin**.

---

## 🛠️ Utilitários DevOps (`tools/`)

- `tools/verificar_telegram.py`: Script seguro para validar o formato e conectividade de `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` em `02_agente_firmware/caixadagua_esp32/secrets.h` diretamente na API do Telegram antes da instalação em campo.
- `tools/gateway_esp32.py` e `tools/embed_ui.py`: Utilitários auxiliares de bancada para simulação local.
