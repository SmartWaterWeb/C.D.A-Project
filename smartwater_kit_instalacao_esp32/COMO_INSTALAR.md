# Kit de Instalação e Gravação de Novo ESP32

Esta pasta contém o pacote autocontido pronto para compilar e gravar um novo ESP32 para qualquer condomínio afiliado.

---

## Como Usar (Passo a Passo em 3 Minutos)

### 1. Gerar o arquivo no site
1. Abra o site do SmartWater na aba **Admin**.
2. Preencha o nome do condomínio, capacidade da caixa e o Wi-Fi do local.
3. Clique em **"Provisionar Condomínio no Firebase e Gerar Arquivos"**.
4. Clique no botão **"Baixar secrets.h"** (ou copie o texto).

### 2. Colocar o `secrets.h` nesta pasta
- Substitua o arquivo `secrets.h` desta pasta pelo arquivo que você acabou de baixar no site (ou abra o `secrets.h` em um bloco de notas e cole o conteúdo gerado).

### 3. Gravar na Placa
1. Abra o arquivo `caixadagua_esp32.ino` no **Arduino IDE**.
2. Conecte o ESP32 ao computador via cabo USB.
3. Selecione a placa: **ESP32 Dev Module** (ou modelo correspondente).
4. Clique no botão **Carregar (Upload / Seta para a direita)**.
5. Quando o carregamento terminar, desconecte a placa.

---

## Ligação dos Sensores e Relés no ESP32

| Componente | Pino do Sensor / Relé | Pino no ESP32 | Alimentação |
|---|---|---|---|
| **Sensor Ultrassônico (JSN-SR04T)** | Trig | **GPIO 5** | 5V / GND |
| **Sensor Ultrassônico (JSN-SR04T)** | Echo | **GPIO 18** *(via divisor 1k/2k)* | GND |
| **Relé da Bomba** | IN / Sinal | **GPIO 19** | 5V / GND |
| **Sensor de Tensão AC (ZMPT101B)** | OUT / Analógico | **GPIO 34** (ADC1) | 5V / GND |
| **Sensor de Corrente AC (SCT-013)** | OUT / Analógico | **GPIO 35** (ADC1) | 3.3V / GND |

---

## O que acontece ao ligar a placa na energia do condomínio:
1. O ESP32 conecta no Wi-Fi automaticamente.
2. Faz o login exclusivo dele no Firebase.
3. Começa a transmitir o nível da água e a bomba em tempo real para o site do cliente.
