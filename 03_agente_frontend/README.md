# 03 - Agente Frontend (PWA Glassmorphism)

O painel web do **SmartWater** é uma aplicação PWA moderna, estática e serverless, projetada para visualização predial com atualização em tempo real via **Google Firebase Realtime Database**.

---

## 🎨 Visual e Experiência do Usuário (Glassmorphism)

- **Estética de Vidro Translúcido**: Construída em tons azuis marítimos profundos com cartões translúcidos (`backdrop-filter: blur(16px)`), bordas luminosas e profundidade tridimensional.
- **Fundo Decorativo Exclusivo**: O arquivo `assets/glass-atmosphere.jpg` provê iluminação ambiente suave sem impactar a legibilidade dos textos.
- **Reservatório Animado**: Representação gráfica do nível em tempo real com indicador visual de menisco, ondas suaves e alertas cromáticos (normal, atenção e crítico).
- **Tratamento de Dados Desatualizados**: Se a telemetria do ESP32 expirar (watchdog de 18 segundos), a animação da água congela e os painéis entram em modo **"Último Estado Conhecido"** para evitar que dados antigos sejam interpretados como atuais.

---

## 📱 Suporte PWA e Navegação Responsiva

- **Desktop**: Barra de navegação flutuante lateral com cartões organizados em grade.
- **Mobile / Celular**: Barra inferior fixa com 5 atalhos rápidos acessíveis com uma das mãos.
- **Instalável**: Registrado via `manifest.webmanifest` e `sw.js` com suporte a execução em tela cheia (standalone) e cache offline do shell da aplicação.

---

## 🏢 Suporte Multi-Condomínio (Multi-ESP32)

O painel é multi-inquilino (*multi-tenant*) nativo:
1. **Pela URL**: Adicione o parâmetro `?id=<condominio_id>` (ex: `https://site.com/?id=condominio_alpha` ou `?id=residencial_flores`).
2. **Pelo Botão de Troca**: Clique em **🏢 Trocar Condomínio** no canto superior para abrir o seletor modal. O último condomínio selecionado fica salvo no `localStorage` do dispositivo.

---

## 📊 Histórico e Central de Operações

- **Gráfico Dinâmico 24 Horas**: Curva de nível traçada via SVG dinâmico (`history.js`).
- **Relatórios de 7, 30 e 90 Dias**: Estatísticas de nível médio, mínimo, máximo, horas estimadas de bomba ligada e acionamentos.
- **Exportação CSV e PDF**: Download direto de planilha de amostras e impressão formatada para laudos prediais.
- **Central de Operações (`operations.js`)**: Lista inteligente de alertas ativos e resolvidos durante a sessão, sem alarmes falsos ao carregar.

---

## 🧪 Testes Automatizados

O frontend possui suíte de testes em Node.js nativo (sem dependências pesadas):
```powershell
node --test tests/*.test.*
```
- `connectivity.test.cjs`: Testa os 8 estados da máquina de conexão e stale status.
- `dom.test.cjs`: Garante que todos os 92 IDs do `app.js` existem no `index.html`.
- `history.test.mjs`: Valida cálculo de médias, detecção de lacunas e geração de CSV.
- `operations.test.mjs`: Valida classificação de severidade e ciclo de vida dos alertas.

---

## 🌐 Como Executar Localmente ou Publicar

- **Execução Local**:
  ```powershell
  python -m http.server 8765 --bind 127.0.0.1
  # Abrir no navegador: http://127.0.0.1:8765/?id=condominio_alpha
  ```
- **Publicação no GitHub Pages**:
  Os arquivos executáveis residem na raiz do repositório (`index.html`, `style.css`, `app.js`, etc.), permitindo ativar o GitHub Pages na raiz da branch (`/root`) com deploy instantâneo.
