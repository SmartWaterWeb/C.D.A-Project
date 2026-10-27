# Gestão de Firmwares por Cliente

Esta pasta serve para armazenar e organizar os arquivos `secrets.h` de cada cliente instalado, evitando que você perca as credenciais de um condomínio quando for gravar a placa de outro.

---

## Estrutura de Pastas

Cada cliente possui sua própria pasta isolada:

```text
02_agente_firmware/
├── caixadagua_esp32/             <-- Código-fonte universal do ESP32 (caixadagua_esp32.ino)
│   └── secrets.h                 <-- secrets.h ATIVO (o que o Arduino IDE está compilando agora)
│
└── clientes/                     <-- Arquivo morto / backup organizado de cada cliente
    ├── condominio_alpha/
    │   └── secrets.h             <-- Credenciais do Alpha (sua bancada de testes)
    ├── residencial_flores/
    │   └── secrets.h             <-- Credenciais do Residencial Flores
    └── torre_horizonte/
        └── secrets.h             <-- Credenciais da Torre Horizonte
```

> **Aviso de Segurança:** O arquivo `.gitignore` já está configurado para ignorar qualquer arquivo `secrets.h` dentro desta pasta. Suas senhas nunca irão para o GitHub.

---

## Como Gravar um Novo Cliente Sem Misturar

1. **Na aba Admin do site:** Cadastre o cliente e clique em **"Baixar secrets.h"**.
2. **Crie uma pasta para o novo cliente:**
   - Exemplo: `02_agente_firmware/clientes/residencial_flores/`
   - Salve o `secrets.h` baixado dentro dessa pasta (assim você nunca perde os dados dele).
3. **Na hora de compilar no Arduino IDE:**
   - Copie esse `secrets.h` para dentro de `02_agente_firmware/caixadagua_esp32/secrets.h`.
   - Conecte o ESP32 e faça o Upload.
4. **Para voltar a mexer no seu condomínio de testes:**
   - Basta copiar o `secrets.h` de `clientes/condominio_alpha/` de volta para `caixadagua_esp32/`.
