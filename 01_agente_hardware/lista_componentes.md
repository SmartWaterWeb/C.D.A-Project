# 📋 LISTA DE MATERIAIS & COMPONENTES (BOM)

Especificação industrial de componentes para montagem em painel elétrico de condomínio:

| Item | Componente | Descrição / Modelo Sugerido | Quantidade | Função |
| :--- | :--- | :--- | :---: | :--- |
| 1 | **Microcontrolador** | ESP32 DevKit V1 (30 ou 36 pinos, Wi-Fi 2.4 GHz) | 1 un | Processador central e servidor de telemetria |
| 2 | **Sensor de Nível** | JSN-SR04T v2.0 ou v3.0 (Transdutor blindado IP67) | 1 un | Medição ultrassônica sem contato na tampa da caixa |
| 3 | **Fonte de Alimentação** | Fonte Chaveada 5V / 2A (Trilho DIN ou tipo plugue industrial) | 1 un | Alimentação isolada para o ESP32 e módulos |
| 4 | **Módulo Relé** | Módulo Relé 5V com Optoacoplador (Ativo em LOW) | 1 un | Chaveamento do comando da bobina da contatora |
| 5 | **Módulo Detector AC** | Módulo Detector de Tensão AC 1 Canal com Optoacoplador | 1 un | Sensoriamento de presença da rede elétrica predial |
| 6 | **Resistor R1 (Echo)** | Resistor de Filme de Carbono / Metal 1kΩ (1/4W, 5% ou 1%) | 1 un | Divisor resistivo limitador de corrente |
| 7 | **Resistor R2 (Echo)** | Resistor de Filme de Carbono / Metal 2kΩ (1/4W, 5% ou 1%) | 1 un | Divisor resistivo de aterramento (5V -> 3.3V) |
| 8 | **Resistor Pull-up AC**| Resistor de 10kΩ (1/4W) | 1 un | Pull-up da saída do optoacoplador para 3.3V |
| 9 | **Snubber RC (Capacitor)** | Capacitor de Filme Polipropileno 100nF (0.1µF) 630V (Classe X2) | 1 un | Supressor de arco voltaico na bobina da contatora |
| 10 | **Snubber RC (Resistor)**  | Resistor de Óxido Metálico ou Fio 100Ω (2W ou 3W) | 1 un | Amortecedor de dV/dt ligado em série com o capacitor |
| 11 | **Gabinete / Caixa** | Caixa Hermética IP65 (Sobrepor ou Trilho DIN) | 1 un | Proteção mecânica e umidade na casa de bombas |
| 12 | **Varistor (DPS)** | MOV 275V RMS / 14D431K (Proteção de Surtos) | 2 un | Proteção contra picos e descargas na rede 220V e contatora |
| 13 | **Fusível de Proteção** | Fusível de Vidro 5x20mm 500mA Rápido + Borne Seccionador | 1 un | Proteção da alimentação da fonte em trilho DIN |

