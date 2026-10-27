# ⚡ AGENTE 1: ENGENHARIA ELÉTRICA & HARDWARE

Este diretório contém os esquemáticos, mapas de conexão e regras de proteção contra ruídos industriais para o microcontrolador **ESP32 DevKit v1 (30 ou 36 pinos)** executando o firmware oficial `02_agente_firmware/caixadagua_esp32/caixadagua_esp32.ino`.

---

## 🛡️ Alocação de Pinos (Pinout Oficial Sincronizado com o Firmware)

O ESP32 possui pinos multifuncionais e conversores analógicos divididos entre `ADC1` e `ADC2`. Como o `ADC2` entra em conflito com o rádio Wi-Fi, todos os sensores analógicos estão alocados exclusivamente no **ADC1 (GPIOs 34 e 35)**:

| Função | Pino ESP32 | Direção | Nível Lógico / Tratamento |
| :--- | :--- | :--- | :--- |
| **Ultrassom TRIG (JSN-SR04T)** | **GPIO 5** | Saída (`OUTPUT`) | Pulso limpo de disparo de 10µs a 3.3V. |
| **Ultrassom ECHO (JSN-SR04T)** | **GPIO 18** | Entrada (`INPUT`) | Pulso retornado; **exige divisor resistivo 1kΩ / 2kΩ** (5V -> 3.3V). |
| **Status da Bomba (Contato Auxiliar)** | **GPIO 19** | Entrada (`INPUT_PULLUP`) | Fecha para `GND` (`LOW`) quando a contatora da bomba atraca. |
| **Sensor de Pressão / Nível ADC** | **GPIO 34** | Entrada (`ADC1_CH6`) | Pino Input-Only (0 a 3.3V). Sem pull-up interno. |
| **Sensor de Corrente (ACS712)** | **GPIO 35** | Entrada (`ADC1_CH7`) | Pino Input-Only (Leitura RMS de corrente da bomba). |

---

## ⚡ Proteções Industriais Essenciais

### 1. Divisor Resistivo no Pino ECHO (JSN-SR04T -> GPIO 18)
O módulo JSN-SR04T opera com alimentação de 5V e o pino ECHO devolve um pulso de 5V. O ESP32 tolera no máximo 3.6V em suas portas digitais.
* **Resistor R1 (em série com ECHO):** 1kΩ (1/4W)
* **Resistor R2 (do GPIO 18 para GND):** 2kΩ (1/4W)
* **Tensão Resultante:** $V_{echo} = 5\text{V} \times \frac{2\text{k}\Omega}{1\text{k}\Omega + 2\text{k}\Omega} = 3.33\text{V}$ (100% seguro).

### 2. Contato Seco / Auxiliar da Contatora (GPIO 19)
O pino **GPIO 19** opera com `INPUT_PULLUP` interno ativado (3.3V em repouso).
* Conecte um bloco de contato auxiliar Normalmente Aberto (**NA / NO**) da contatora da bomba entre o **GPIO 19** e o **GND** do ESP32 (ou através de acoplador óptico isolado).
* Quando a bomba liga, o contato fecha para `GND` (`LOW`) e o firmware contabiliza acionamento e potência elétrica.

### 3. Snubber RC na Bobina do Contator
A bobina indutiva do contator gera transientes de alta frequência (EMI) que podem causar *brownout* ou reinicialização no desligamento do motor.
* **Instalação Recomendada:** Diretamente em paralelo com os bornes **A1 e A2** da bobina do contator.
* **Especificação:** Capacitor de Polipropileno de **100nF / 630V** em série com Resistor de **100Ω / 2W**.
