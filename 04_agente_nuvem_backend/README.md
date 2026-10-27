# 04 - Agente Nuvem e Backend (Firebase Multi-Tenant & DevOps)

Este diretório concentra a inteligência de nuvem, segurança do banco de dados, regras de acesso e utilitários DevOps do **SmartWater**.

---

## ☁️ Arquitetura de Nuvem

O sistema utiliza o **Google Firebase Realtime Database (RTDB)** como broker de mensagens e armazenamento em tempo real:
- **Latência Baixa**: Conexão WebSocket bidirecional contínua entre o painel web e a nuvem.
- **Isolamento de Segurança**: Cada condomínio possui nó próprio (`/condominios/<id>/`).
- **Autenticação Baseada em Regras**: As regras em `firebase.rules.json` garantem que:
  - Dispositivos ESP32 só conseguem gravar dados no condomínio para o qual foram autorizados no nó `/acesso/<id>/dispositivos/<uid>`.
  - Operadores e síndicos só conseguem ler dados do condomínio registrado para o seu UID no nó `/acesso/<id>/operadores/<uid>`.

---

## 📄 Arquivos de Regras e Acesso

- `firebase.rules.json`: Regras de segurança completas para publicar no Firebase Console.
- `firebase.access.example.json`: Modelo de dados da estrutura de controle de acesso.
- `GUIA_ADICIONAR_NOVO_ESP32.md`: Manual prático passo a passo para conectar o 2º ESP32.

---

## 🛠️ Utilitários DevOps (`tools/`)

- `tools/verificar_telegram.py`: Script seguro para verificar sintaxe e conectividade do token e chat ID da API do Telegram sem vazar segredos nem enviar mensagens falsas.
- `tools/gateway_esp32.py`: Simulador/gateway de bancada herdado para testes de integração local.
- `tools/embed_ui.py`: Compactador de interface web para gzip (caso precise de fallback embarcado).
