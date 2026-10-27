# 📘 Guia Prático: Como Adicionar um Novo ESP32 ao Sistema

Este guia explica exatamente o passo a passo para configurar e conectar um **segundo (ou terceiro) ESP32** ao **SmartWater**, integrando-o ao **Google Firebase Realtime Database**, ao **Telegram** e ao **Painel Web**.

---

## 🎯 Visão Geral do Multi-Condomínio

O sistema foi arquitetado de forma nativa para suportar múltiplos dispositivos sem necessidade de alterar o código do painel web. Cada ESP32 representa um condomínio ou reservatório independente:

```
Firebase RTDB Root
├── condominios/
│   ├── condominio_alpha/           <-- ESP32 #1 (Ex: Edifício Alpha)
│   │   ├── telemetria              <-- Leituras a cada 2-4s
│   │   ├── config                  <-- Dimensões e calibração
│   │   └── historico/amostras      <-- Amostras a cada 15min
│   │
│   └── residencial_flores/         <-- ESP32 #2 (Novo ESP32!)
│       ├── telemetria
│       ├── config
│       └── historico/amostras
│
└── acesso/                         <-- Controle de quem pode ler/escrever
    ├── condominio_alpha
    └── residencial_flores
```

---

## 📋 Passo 1: Definir o Identificador do Novo ESP32

Escolha um `ID` único em letras minúsculas sem espaços ou acentos (ex: `residencial_flores`, `bloco_b`, `cisterna_central`).

Exemplo para este guia:
- **ID**: `residencial_flores`
- **Nome de Exibição**: `Residencial Flores - Bloco B`

---

## 🔐 Passo 2: Criar a Conta do Dispositivo no Firebase Authentication

Cada ESP32 deve possuir sua própria credencial de login para segurança do banco de dados:

1. Acesse o [Firebase Console](https://console.firebase.google.com/) do seu projeto.
2. No menu lateral, vá em **Autenticação (Authentication) > Users**.
3. Clique em **Adicionar usuário**.
4. Crie uma conta exclusiva para a nova placa, por exemplo:
   - **E-mail**: `esp32-flores@smartwater.local` (ou qualquer e-mail fictício/real que você controlar).
   - **Senha**: Crie uma senha forte (ex: `Flores@Smart2026!`).
5. Copie o **Identificador do Usuário (UID)** gerado pelo Firebase para esse usuário recém-criado (ex: `aBcDeFg12345...`).

---

## 🛡️ Passo 3: Cadastrar as Permissões no Firebase Realtime Database

1. No Firebase Console, vá em **Realtime Database > Dados**.
2. No nó `/acesso/`, adicione a entrada para o novo condomínio:
   ```json
   "residencial_flores": {
     "nome": "Residencial Flores - Bloco B",
     "dispositivos": {
       "COLE_AQUI_O_UID_DO_ESP32_CRIADO_NO_PASSO_2": "write"
     },
     "operadores": {
       "COLE_AQUI_O_UID_DO_SINDICO_OU_SEU_USUARIO": "read"
     }
   }
   ```
3. *(Opcional)* Crie a configuração inicial em `/condominios/residencial_flores/config`:
   ```json
   {
     "capacidade_litros": 15000,
     "altura_util_cm": 250,
     "distancia_sensor_topo_cm": 25,
     "atualizado_em": 1729000000000
   }
   ```
> Se você não criar esse nó manualmente, o próprio firmware criará com os valores padrão ao iniciar.

---

## 🤖 Passo 4: Configurar o Bot do Telegram (Opcional, mas Recomendado)

Se o novo condomínio tiver seu próprio grupo de zeladoria/síndico no Telegram:
1. Abra o `@BotFather` no Telegram e envie `/newbot`.
2. Dê um nome (ex: `Residencial Flores Água Bot`).
3. Guarde o **Token da API** fornecido.
4. Crie o grupo no Telegram para o novo prédio, adicione o bot ao grupo e obtenha o `chat_id` numérico do grupo (ex: `-1001234567890`).

---

## 💻 Passo 5: Configurar o Firmware do 2º ESP32

1. Abra a pasta `02_agente_firmware/caixadagua_esp32/caixadagua_esp32.ino` na Arduino IDE.
2. No início do arquivo `caixadagua_esp32.ino`, altere as linhas 31 e 32:
   ```cpp
   const char* CONDOMINIO_ID = "residencial_flores";
   const char* CONDOMINIO_NOME = "Residencial Flores - Bloco B";
   ```
3. Abra a aba `secrets.h` e configure:
   ```cpp
   #define WIFI_SSID       "WIFI_DO_RESIDENCIAL_FLORES"
   #define WIFI_PASSWORD   "SENHA_DO_WIFI"

   #define API_KEY         "SUA_FIREBASE_WEB_API_KEY"
   #define DATABASE_URL    "https://seu-projeto-default-rtdb.firebaseio.com"

   #define DEVICE_EMAIL    "esp32-flores@smartwater.local"
   #define DEVICE_PASSWORD "Flores@Smart2026!"

   #define ENABLE_TELEGRAM         1
   #define TELEGRAM_BOT_TOKEN      "TOKEN_DO_NOVO_BOT"
   #define TELEGRAM_CHAT_ID        "-1001234567890"
   #define TELEGRAM_SIMULATED_MODE false
   ```
4. Conecte o segundo ESP32 no computador e faça o **Upload**.
5. Abra o **Monitor Serial (115200)** e confirme:
   - Conexão com o Wi-Fi local estabelecida.
   - Login no Firebase Authentication com o e-mail exclusivo realizado com sucesso.
   - Envio da primeira telemetria para `/condominios/residencial_flores/telemetria`.

---

## 🌐 Passo 6: Visualizar no Painel Web

Pronto! Você não precisa recompilar nem alterar o site. Para abrir a telemetria do novo ESP32:

1. **Acesso Direto**:
   Acesse a URL passando o ID correspondente:
   ```
   https://seu-usuario.github.io/caixadagua2/?id=residencial_flores
   ```
   *(Ou localmente: `http://127.0.0.1:8765/?id=residencial_flores`)*

2. **Pelo Seletor de Condomínio**:
   - Abra o site.
   - Clique no botão **🏢 Trocar Condomínio**.
   - Digite `residencial_flores`.
   - O painel sincronizará automaticamente em tempo real com o novo ESP32!
