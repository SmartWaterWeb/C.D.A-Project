# Guia do Operador: Como Cadastrar e Configurar um Novo Condomínio

Este guia descreve o procedimento passo a passo para implantar o **SmartWater** em um novo cliente condomínio, utilizando a **Central do Fornecedor (Admin Universal)** do painel web.

---

## 1. Visão Geral da Arquitetura Comercial

No SmartWater, **você possui uma conta Admin Universal única**, enquanto cada cliente possui apenas acessos isolados:

| Perfil | Quem utiliza | Permissões |
|---|---|---|
| **Admin Universal** | Você (Fornecedor / Operador) | Acesso total a todos os condomínios, calibração, provisionamento e diagnósticos |
| **Síndico** | Administração predial / Zelador | Monitoramento ao vivo, relatórios diários/mensais e **calibração das dimensões da caixa** |
| **Moradores** | Portaria / Moradores | Monitoramento ao vivo e relatórios (modo **somente leitura**, sem calibração e sem admin) |
| **ESP32** | Placa do condomínio | Permissão exclusiva de escrita na telemetria e no histórico daquele condomínio |

---

## 2. Passo a Passo no Painel Web (Sem abrir o Firebase)

Toda a criação de contas e liberação de permissões é automatizada pelo próprio site:

1. Acesse o site do SmartWater logado com sua **conta de Admin**.
2. Clique na aba **Admin** no topo da tela.
3. No formulário **"Cadastrar Novo Condomínio Afiliado e Gerar Logins"**, preencha:
   - **Identificador Único (ID):** O apelido do condomínio em minúsculas, sem acento ou espaço (ex: `residencial_flores`, `torre_sul`).
   - **Nome do Condomínio:** O nome de exibição oficial (ex: `Residencial Flores`).
   - **Capacidade Útil (Litros):** Volume total do reservatório (ex: `15000`).
   - **Altura Útil (cm):** Altura da lâmina d'água da caixa (ex: `250`).
   - **Distância do Sensor ao Topo (cm):** Distância física do sensor ultrassônico até o nível 100% (ex: `20`).
4. **Contas do Cliente:** O painel gera e-mails e senhas sugeridos automaticamente. Você pode manter ou ajustar:
   - E-mail e senha do **Síndico**.
   - E-mail e senha dos **Moradores**.
5. **Dados de Instalação do ESP32:**
   - **Wi-Fi SSID e Senha:** A rede Wi-Fi 2.4 GHz do condomínio onde a placa será instalada.
   - **E-mail e Senha do ESP32:** E-mail de conexão da placa (ex: `esp32.flores@smartwater.app`).
   - *(Opcional)* Token e Chat ID do Bot do Telegram para alertas imediatos no celular do zelador.
6. Clique no botão **"Provisionar Condomínio no Firebase e Gerar Arquivos"**.

O sistema executará em segundo plano:
- A criação dos usuários no Firebase Authentication.
- A gravação dos níveis de permissão em `/access/<UID>/<condominio_id>`.
- O registro das dimensões da caixa em `/condominios/<condominio_id>/config`.

---

## 3. Entrega dos Acessos ao Cliente

Após o provisionamento, dois quadros de resultados aparecerão no final da página:

### A. Comunicado de Acesso para o Cliente
Clique em **"Copiar Texto"** ou **"Baixar .txt"**. O arquivo contém a mensagem pronta para enviar no WhatsApp ou e-mail do Síndico:
- Link de acesso direto exclusivo (`https://smartwaterweb.github.io/C.D.A-Project/?id=seu_condominio`).
- Credenciais do Síndico (com calibração).
- Credenciais dos Moradores (somente leitura).
- Instruções de instalação como aplicativo (PWA no Android e iPhone).

---

## 4. Gravação do Firmware no Novo ESP32

Na mesma tela, o painel gera o arquivo **`secrets.h`** completo e pronto para compilação:

1. Clique em **"Baixar secrets.h"** (ou copie o código).
2. Substitua o arquivo `secrets.h` dentro da pasta:
   ```
   02_agente_firmware/caixadagua_esp32/secrets.h
   ```
3. Conecte o novo ESP32 no computador via cabo USB.
4. Abra o projeto no Arduino IDE ou VS Code (PlatformIO) e faça o upload para a placa.
5. Pronto! Ao ligar no condomínio, o ESP32 conectará no Wi-Fi e começará a enviar a telemetria ao vivo.

---

## 5. Como Inspecionar o Novo Condomínio Depois de Pronto

Como Admin Universal, você pode alternar entre qualquer cliente com 1 clique:
1. Abra a aba **Admin**.
2. Na seção **"Condomínios Afiliados no Sistema"**, clique no botão com o nome do condomínio desejado.
3. O painel alternará instantaneamente a telemetria, histórico e alertas para aquele cliente.
