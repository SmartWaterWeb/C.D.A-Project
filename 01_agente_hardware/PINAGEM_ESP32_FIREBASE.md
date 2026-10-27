# Pinagem e Hardware — Sistema Multi-Condomínio ESP32 (Firebase RTDB)

Este documento detalha a pinagem exata utilizada no firmware atual (`caixadagua_esp32.ino`) e os cuidados elétricos necessários para operar tanto o primeiro ESP32 quanto os próximos módulos a serem adicionados ao sistema.

---

## 📌 Pinagem Padrão do ESP32 (DevKit v1 — 30/38 pinos)

| Periférico | Função | Pino ESP32 | Nível Lógico / Faixa | Observações Críticas |
| :--- | :--- | :---: | :---: | :--- |
| **Sensor Ultrassônico (JSN-SR04T / HC-SR04)** | `TRIG` (Disparo) | **GPIO 5** | Saída 3.3V | Pulso mínimo de 10µs. |
| **Sensor Ultrassônico (JSN-SR04T / HC-SR04)** | `ECHO` (Retorno) | **GPIO 18** | Entrada 3.3V | **Obrigatório Divisor Resistivo**: O ECHO emite 5V. Use 1kΩ em série e 2kΩ para o GND. |
| **Sensor Hidrostático 4-20mA / 0-5V** | Nível Analógico | **GPIO 34** | ADC1 (0 a 3.3V) | Pinos do ADC1 não conflitam com Wi-Fi. (Opcional, alternativo ao ultrassom). |
| **Feedback de Status da Bomba** | Monitoramento Relé | **GPIO 19** | Entrada Digital | HIGH = Bomba Ligada / Relé Ativo. Conectar ao contato auxiliar ou optoacoplador. |
| **Sensor de Corrente ACS712** | Monitoramento de Consumo | **GPIO 35** | ADC1 (0 a 3.3V) | Entrada analógica ADC1 para cálculo RMS. Ajustar `ACS_ZERO_V` e `ACS_SENS_V_A`. |

---

## ⚠️ Regras Críticas de Hardware

### 1. Conflito entre ADC2 e Wi-Fi
- O ESP32 possui dois blocos de conversores analógico-digitais: **ADC1** (GPIOs 32, 33, 34, 35, 36, 39) e **ADC2** (GPIOs 0, 2, 4, 12, 13, 14, 15, 25, 26, 27).
- **O ADC2 é desativado internamente pelo hardware do ESP32 sempre que o Wi-Fi está transmitindo dados.**
- Portanto, **nunca** utilize pinos do ADC2 para leituras analógicas (ACS712 ou sensor de pressão). As portas **GPIO 34 e GPIO 35** utilizadas pelo projeto pertencem ao **ADC1**, garantindo leituras analógicas 100% estáveis mesmo durante a sincronização com o Firebase.

### 2. Divisor de Tensão no Pino ECHO (JSN-SR04T)
O transdutor impermeável JSN-SR04T é alimentado por 5V e o pino ECHO devolve um sinal de 5V. A entrada do ESP32 suporta no máximo 3.3V.
```text
  JSN-SR04T (ECHO 5V) ----[ 1kΩ ]----+----> GPIO 18 (ESP32 lê ~3.3V seguro)
                                     |
                                  [ 2kΩ ]
                                     |
                                    GND
```

### 3. Isolamento e Proteção contra Ruído da Bomba
Ao monitorar a bobina ou contato da contatora da motobomba:
- Utilize sempre módulo optoacoplado para isolar a rede AC de potência dos pinos lógicos do ESP32.
- Instale um **filtro Snubber RC** (100nF 630V Classe X2 + 100Ω 2W) em paralelo com os bornes A1 e A2 da bobina da contatora para eliminar arcos e picos de dV/dt gerados no desligamento do motor.

---

## 🔁 Adicionando um Segundo ESP32 (Hardware)
Para o segundo ESP32 (seja para um 2º reservatório ou outro condomínio):
1. Monte exatamente o mesmo circuito de pinagem (GPIO 5, 18, 19, 34, 35).
2. Cada ESP32 terá sua própria fonte de alimentação independente de 5V 2A de boa qualidade.
3. No firmware, a única diferença física será o identificador gravado em software (`CONDOMINIO_ID`).
