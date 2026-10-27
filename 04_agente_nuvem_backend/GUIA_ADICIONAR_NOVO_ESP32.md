# 📘 Guia Prático: Como Adicionar um Novo ESP32 e Operar o Sistema (Operador, Cliente e Admin)

Este guia detalha o fluxo completo de instalação, configuração no **Google Firebase Realtime Database**, funcionamento do **Telegram** e operação comercial para os **3 perfis de uso** do sistema **SmartWater**.

---

## 👥 Os 3 Perfis de Uso no Modelo Comercial

| Perfil | Quem é | Como Acessa | Responsabilidades |
| :--- | :--- | :--- | :--- |
| **1. Operador (Instalador)** | Técnico que vai até o condomínio instalar a caixa e o ESP32. | Painel Web no celular/notebook + Botão **Calibrar** e **Diagnóstico**. | Fixar sensores, gravar credenciais iniciais do ESP32, medir a caixa com trena, calibrar litragem/altura pelo painel e validar sinal Wi-Fi (dBm) no barrilete. |
| **2. Cliente (Síndico / Zelador)** | Gestão interna do condomínio. | Site / App instalado na Tela de Início (**PWA**) + Grupo do **Telegram**. | Faz login com e-mail e senha (cai direto no próprio condomínio), consulta nível/bomba/histórico, gera relatórios para assembleia e recebe alertas automáticos no Telegram. |
| **3. Admin (Gestor do Sistema)** | Administração central e manutenção. | Firebase Console + Painel Web Multi-Condomínio (`?admin=1` ou conta com múltiplos condomínios). | Cria contas no Firebase Auth, gerencia permissões em `/access`, supervisiona todos os prédios pelo botão **Condomínios** e realiza manutenção preventiva. |

---

## 🎯 Estrutura Real do Banco no Firebase (`firebase.rules.json`)

Cada condomínio é isolado sob `/condominios/<id>` e as permissões são controladas por `UID` dentro do nó raiz `/access`:

```
Firebase RTDB Root
├── access/                         <-- Controle de Permissões (Indexado por UID)
│   ├── <UID_DO_ESP32_ALPHA>/
│   │   └── condominio_alpha: { "read": false, "write": true }
│   ├── <UID_DO_SINDICO_ALPHA>/
│   │   └── condominio_alpha: { "read": true, "write": false }
│   └── <UID_DO_ADMIN>/             <-- Admin tem acesso a todos os condomínios
│       ├── condominio_alpha: { "read": true, "write": true }
│       └── residencial_flores: { "read": true, "write": true }
│
└── condominios/
    ├── condominio_alpha/           <-- ESP32 #1
    │   ├── telemetria              <-- Leituras em tempo real (2-4s)
    │   ├── config                  <-- Dimensões calibradas pelo Operador
    │   └── historico/amostras      <-- Amostras consolidadas a cada 15min
    │
    └── residencial_flores/         <-- ESP32 #2 (Novo Condomínio!)
        ├── telemetria
        ├── config
        └── historico/amostras
```

---

## 📋 Passo 1: Definir o Identificador do Novo Condomínio

Escolha um `ID` único em letras minúsculas, números, `_` ou `-` (3 a 64 caracteres):
- **ID**: `residencial_flores`
- **Nome de Exibição**: `Residencial Flores - Reservatório Superior`

---

## 🔐 Passo 2: Criar Contas no Firebase Authentication (Admin)

No [Firebase Console](https://console.firebase.google.com/) > **Authentication > Users > Adicionar usuário**:

1. **Conta exclusiva do ESP32** (grava telemetria):
   - **E-mail**: `esp32-flores@smartwater.local`
   - **Senha**: Senha forte exclusiva da placa.
   - Copie o **UID** gerado (ex: `UID_ESP32_FLORES`).
2. **Conta do Cliente / Síndico** (visualiza painel e calibra caixa):
   - **E-mail**: `sindico@residencialflores.com.br`
   - **Senha**: Senha entregue ao síndico/zelador.
   - Copie o **UID** gerado (ex: `UID_SINDICO_FLORES`).

---

## 🛡️ Passo 3: Liberar Permissões no Nó `/access` (Admin)

1. No Firebase Console > **Realtime Database > Dados**, dentro da chave raiz `/access`, adicione os UIDs criados:
   ```json
   {
     "access": {
       "UID_ESP32_FLORES": {
         "residencial_flores": {
           "read": false,
           "write": true
         }
       },
       "UID_SINDICO_FLORES": {
         "residencial_flores": {
           "read": true,
           "write": false
         }
       },
       "UID_DO_ADMIN": {
         "condominio_alpha": { "read": true, "write": true },
         "residencial_flores": { "read": true, "write": true }
       }
     }
   }
   ```
   > **Nota importante**: Graças às regras em `firebase.rules.json`, qualquer usuário com `"read": true` também pode atualizar as dimensões físicas em `/condominios/<id>/config` usando o botão **Calibrar** do painel. Além disso, ao fazer login, o painel consulta `/access/<uid>` e direciona o síndico **automaticamente** para o condomínio dele!

2. *(Opcional)* Configuração inicial em `/condominios/residencial_flores/config` (respeitando os nomes exatos exigidos pelas regras):
   ```json
   {
     "capacidade_litros": 15000,
     "altura_total_cm": 220,
     "distancia_sensor_topo": 25
   }
   ```

---

## 🤖 Passo 4: Como Funciona e Como Configurar o Telegram (Cliente & Operador)

### Arquitetura do Bot no Firmware (`telegram_service.cpp`)
- **Paradigma 1 Bot + 1 Grupo por Condomínio**: O ESP32 roda uma tarefa dedicada no Core 0 (`telegramWorker`) que se comunica via HTTPS TLS com a API do Telegram.
- **Segurança por Chat ID Fixo**: O bot responde e envia alertas **exclusivamente** para o `TELEGRAM_CHAT_ID` configurado em `secrets.h`. Mensagens enviadas por desconhecidos fora do grupo autorizado são descartadas imediatamente pelo ESP32.
- **Como adicionar múltiplos moradores/síndico/zelador**: Basta criar um **Grupo no Telegram** do condomínio, adicionar o Bot no grupo e colocar o `chat_id` do grupo (número negativo, ex: `-1001234567890`) no `secrets.h`. Todos os participantes do grupo receberão os alertas e poderão clicar nos botões interativos, sem limite de membros e sem perder cadastros quando o ESP32 reiniciar.
- **Catálogo de Notificações Automáticas**:
  1. **Boot (`✅ Monitor iniciado`)**: Enviado assim que o ESP32 liga e sincroniza o relógio NTP, informando nível atual, volume em litros e estado da bomba.
  2. **Nível Crítico (`🔴 Nível crítico baixo <= 20%` / `🟠 Alerta de nível alto >= 95%`)**: Com histerese automática (normaliza em `23%` e `92%`) para evitar spam de mensagens quando a água ondula.
  3. **Bomba (`🟢 Bomba ligada` / `⚪ Bomba desligada`)**: Notifica cada acionamento e desligamento com a corrente elétrica instantânea (A).
  4. **Sobrecarga Elétrica (`🔴 Corrente alta > 15.0 A`)**: Alerta imediato de possível travamento de rotor ou falha mecânica.
  5. **Falha de Sensor (`🔴 Sensor sem leitura`)**: Alerta caso o cabo do JSN-SR04T desconecte ou perca o eco.
  6. **Calibração Remota (`⚙️ Configuração atualizada`)**: Confirma no grupo sempre que alguém altera as medidas da caixa pelo site.
  7. **Resumo de 12h**: Relatório periódico de saúde operacional.
- **Comandos Interativos (com botões Inline)**:
  - `/status` ou `/start`: Exibe painel rápido com botões clicáveis (**Ver Nível**, **Ver Bomba**, **Sistema**).
  - `/nivel`, `/bomba`, `/sistema`, `/ajuda`.

---

## 💻 Passo 5: Gravação e Comissionamento em Campo (Operador)

1. Abra `02_agente_firmware/caixadagua_esp32/caixadagua_esp32.ino` na Arduino IDE.
2. Defina o ID e Nome nas linhas 31–32:
   ```cpp
   const char* CONDOMINIO_ID = "residencial_flores";
   const char* CONDOMINIO_NOME = "Residencial Flores - Reservatório Superior";
   ```
3. Preencha `02_agente_firmware/caixadagua_esp32/secrets.h` (baseado em `secrets.h.example`) e valide antes de gravar rodando:
   ```powershell
   python 04_agente_nuvem_backend/tools/verificar_telegram.py
   ```
4. Grave o ESP32 e instale no barrilete/casa de bombas.
5. **Calibração sem computador**:
   - Abra o site no celular e faça login.
   - Clique em **Calibrar**, insira a Capacidade (L), Altura Útil (cm) e Distância do Sensor ao Nível 100% (cm) medidas na trena e salve. Em até 15 segundos o ESP32 grava os valores na memória Flash permanente (NVS).
6. **Validação de Campo**:
   - Clique em **Diagnóstico** na barra lateral e confira se o **Sinal Wi-Fi no Barrilete** está acima de `-75 dBm` e se o **Sensor Ultrassônico** indica `Saudável (Eco Ativo)`.

---

## 📱 Passo 6: Entrega ao Cliente (PWA na Tela de Início)

1. No celular do Síndico ou Zelador, abra o link do painel e faça login com a conta criada para ele.
2. O sistema identificará automaticamente o condomínio vinculado ao UID dele e manterá a sessão salva.
3. No navegador do celular:
   - **Android (Chrome)**: Clique no botão **Instalar app** no topo da tela (ou menu ⋮ > *Adicionar à tela inicial*).
   - **iPhone (Safari)**: Toque em *Compartilhar* > *Adicionar à Tela de Início*.
4. O aplicativo ficará instalado com ícone próprio em tela cheia (`standalone`), pronto para uso diário.
