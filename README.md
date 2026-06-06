# FitAI Server

Backend do app FitAI — recebe respostas do WhatsApp e expõe API para o app.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/webhook/whatsapp` | Recebe mensagens do WhatsApp (Twilio) |
| GET | `/api/status` | Health check + resumo |
| GET | `/api/checkins` | Lista check-ins |
| POST | `/api/checkins` | Registra check-in |
| GET | `/api/weight` | Histórico de peso |
| POST | `/api/weight` | Registra peso |
| POST | `/api/trigger-weight-prompt` | Dispara prompt de peso (Make.com) |

## Comandos WhatsApp reconhecidos

- **SIM / S / TREINEI** → registra treino feito ✅
- **NÃO / N** → registra falta ❌
- **112.5** (qualquer número) → registra peso ⚖️
- **STATUS** → resumo do progresso 📊
- **AJUDA** → lista de comandos ❓

## Deploy no Render.com

1. Suba este projeto para um repositório GitHub
2. No Render, crie um novo **Web Service**
3. Conecte o repositório
4. Configure as variáveis de ambiente (Environment Variables):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` → `whatsapp:+14155238886`
   - `MY_WHATSAPP_NUMBER` → `whatsapp:+55SEU_NUMERO`
5. **Build Command:** `npm install`
6. **Start Command:** `npm start`
7. Após o deploy, copie a URL gerada (ex: `https://fitai-server.onrender.com`)

## Configurar webhook no Twilio

1. No console da Twilio, vá em **Messaging → Try it out → WhatsApp**
2. Em **Sandbox Settings**, no campo **"When a message comes in"**:
   - URL: `https://fitai-server.onrender.com/webhook/whatsapp`
   - Method: `HTTP POST`
3. Salve

## Configurar no Make.com

No cenário de domingo (pesagem semanal), troque o bloco Twilio por:
- **HTTP → Make a request**
  - URL: `https://fitai-server.onrender.com/api/trigger-weight-prompt`
  - Method: POST

Isso faz o servidor enviar a mensagem E ativar o modo de espera de peso.
