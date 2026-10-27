# ⚡ AGENTE 1: ENGENHARIA ELÉTRICA & HARDWARE

Este diretório contém os esquemáticos, mapas de conexão e regras de proteção contra ruídos industriais para o microcontrolador **ESP32 DevKit v1 (30 ou 36 pinos)**.

---

## 🛡️ Alocação de Pinos (Pinout Seguro)

O ESP32 possui pinos multifuncionais complexos. Para garantir **100% de confiabilidade em partidas e reinicializações**, a seleção de pinos foi feita sob as seguintes regras:

1. **Evitar Strapping Pins:** GPIO 0, 2, 12 e 15 determinam o modo de boot do processador. Não devem possuir cargas que alterem seu estado durante a inicialização.
2. **Sem Interferência na Flash SPI:** GPIOs 6 a 11 são conectados internamente à memória Flash e **nunca** devem ser usados.
3. **Uso de Pinos Input-Only:** GPIOs 34, 35, 36 (VP) e 39 (VN) não possuem pull-up/pull-down interno e funcionam exclusivamente como entradas de sinal analógico/digital.

### Tabela Oficial de Pinagem:
| Função | Pino ESP32 | Direção | Nível Lógico / Tratamento |
| :--- | :--- | :--- | :--- |
| **Ultrassom TRIG** | **GPIO 25** | Saída | Pulso limpo de disparo de 10µs a 3.3V. |
| **Ultrassom ECHO** | **GPIO 26** | Entrada | Pulso retornado; requer divisor resistivo (5V -> 3.3V). |
| **Comando Relé Bomba** | **GPIO 27** | Saída | Ativo em nível LOW. Mantido em HIGH no boot. |
| **Detector de Fase AC** | **GPIO 35** | Entrada | Pino Input-Only. Pull-up externo de 10kΩ ligado a 3.3V. |
| **LED Diagnóstico** | **GPIO 2** | Saída | Pisca durante o Wi-Fi e acende fixo com link ativo. |

---

## ⚡ Proteções Industriais Essenciais

### 1. Divisor Resistivo no Pino ECHO (JSN-SR04T)
O sensor ultrassônico opera com alimentação de 5V e o pino ECHO devolve um sinal de 5V. O ESP32 tolera no máximo 3.6V em suas entradas digitais.
* **Resistor R1 (Série):** 1kΩ (1/4W)
* **Resistor R2 (Para GND):** 2kΩ (1/4W)
* **Tensão Resultante:** $V_{echo} = 5\text{V} \times \frac{2\text{k}\Omega}{1\text{k}\Omega + 2\text{k}\Omega} = 3.33\text{V}$ (100% seguro).

### 2. Snubber RC na Bobina do Contator
A bobina indutiva do contator (AC-1/AC-3) gera transientes de alta frequência (Back-EMF / EMI) que reiniciam o microcontrolador no momento do desligamento.
* **Instalação Obrigatória:** Diretamente em paralelo com os bornes **A1 e A2** da bobina do contator (e NÃO nos contatos do relé).
* **Especificação:** Capacitor de Polipropileno de **100nF / 630V** em série com Resistor de **100Ω / 2W**.
