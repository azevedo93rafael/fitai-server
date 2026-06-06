const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ── In-memory store (persiste enquanto o servidor rodar)
// No Render free tier, o servidor dorme após inatividade —
// para persistência real, conecte um banco. Por agora funciona perfeitamente.
const store = {
  checkins: {},   // { "2025-06-03": true/false }
  weightLog: [],  // [{ date, kg }]
  pendingInput: null, // estado da conversa (ex: esperando peso)
};

// ── Helpers ─────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const MY_NUMBER   = process.env.MY_WHATSAPP_NUMBER; // ex: whatsapp:+5521999999999
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER; // whatsapp:+14155238886

function today() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

async function sendWA(to, body) {
  try {
    await twilioClient.messages.create({ from: FROM_NUMBER, to, body });
  } catch (e) {
    console.error('Twilio send error:', e.message);
  }
}

function calcStreak(checkins) {
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (checkins[key] === true) streak++;
    else if (checkins[key] === false) break;
  }
  return streak;
}

// ── WEBHOOK — recebe mensagens do WhatsApp ───────────────
app.post('/webhook/whatsapp', async (req, res) => {
  // Twilio envia como form-urlencoded
  const from = req.body.From;   // ex: whatsapp:+5521999999999
  const body = (req.body.Body || '').trim().toLowerCase();

  console.log(`📱 Mensagem recebida de ${from}: "${body}"`);

  // Segurança: ignora mensagens de outros números
  if (MY_NUMBER && from !== MY_NUMBER) {
    console.log('⚠️ Número não autorizado:', from);
    return res.status(200).send('<Response></Response>');
  }

  let reply = '';

  // ── Estado: esperando peso após lembrete de domingo ──
  if (store.pendingInput === 'weight') {
    const kg = parseFloat(body.replace(',', '.'));
    if (!isNaN(kg) && kg > 40 && kg < 300) {
      const entry = { date: today(), kg };
      const existing = store.weightLog.findIndex(l => l.date === today());
      if (existing >= 0) store.weightLog[existing] = entry;
      else store.weightLog.push(entry);
      store.pendingInput = null;

      // Calcula diferença com último registro
      const prev = store.weightLog.length >= 2
        ? store.weightLog[store.weightLog.length - 2]
        : null;
      const diff = prev ? (prev.kg - kg).toFixed(1) : null;
      const diffText = diff
        ? (diff > 0 ? `⬇️ ${diff} kg a menos que a semana passada!` : diff < 0 ? `⬆️ ${Math.abs(diff)} kg a mais — bora focar!` : '➡️ Peso estável esta semana.')
        : '';

      reply = `✅ *Peso registrado: ${kg} kg*\n${diffText}\n\n📊 Abra o FitAI para ver seu gráfico atualizado!`;
    } else {
      reply = '⚠️ Não entendi o valor. Por favor, responda com seu peso em kg.\nExemplo: *112.5*';
    }

  // ── Check-in SIM ────────────────────────────────────
  } else if (['sim', 's', 'yes', '✅', 'fiz', 'treinei', '👍'].includes(body)) {
    store.checkins[today()] = true;
    const streak = calcStreak(store.checkins);
    const streakMsg = streak >= 7
      ? `🔥 ${streak} dias seguidos! Você é uma máquina!`
      : streak >= 3
      ? `🔥 ${streak} dias consecutivos! Continue assim!`
      : `💪 Treino registrado! ${streak} dia(s) de sequência.`;

    reply = `✅ *Check-in confirmado!*\n\n${streakMsg}\n\nAbra o FitAI para registrar suas cargas de hoje 🏋️`;

  // ── Check-in NÃO ────────────────────────────────────
  } else if (['nao', 'não', 'n', 'no', '❌', 'nã', 'nop'].includes(body)) {
    store.checkins[today()] = false;
    reply = `📝 *Falta registrada.*\n\nNão tem problema! Amanhã é um novo dia 💪\n\nSe quiser, me diga o motivo e vejo como posso ajudar.`;

  // ── Usuário manda peso direto ───────────────────────
  } else if (/^\d{2,3}([.,]\d{1,2})?$/.test(body)) {
    const kg = parseFloat(body.replace(',', '.'));
    if (kg > 40 && kg < 300) {
      const entry = { date: today(), kg };
      const existing = store.weightLog.findIndex(l => l.date === today());
      if (existing >= 0) store.weightLog[existing] = entry;
      else store.weightLog.push(entry);

      reply = `⚖️ *Peso ${kg} kg registrado!*\n\n📊 Abra o FitAI para ver seu progresso atualizado.`;
    }

  // ── Comando: status ─────────────────────────────────
  } else if (['status', 'resumo', 'como estou', 'progresso'].includes(body)) {
    const streak = calcStreak(store.checkins);
    const lastWeight = store.weightLog.length
      ? store.weightLog[store.weightLog.length - 1]
      : null;
    const thisWeekCheckins = Object.entries(store.checkins)
      .filter(([date]) => {
        const d = new Date(date);
        const now = new Date();
        const diff = (now - d) / (1000 * 60 * 60 * 24);
        return diff <= 7;
      })
      .filter(([, v]) => v === true).length;

    reply = `📊 *Seu status FitAI:*\n\n`
      + `⚖️ Último peso: ${lastWeight ? `${lastWeight.kg} kg (${formatDate(lastWeight.date)})` : 'não registrado'}\n`
      + `🏋️ Treinos esta semana: ${thisWeekCheckins}\n`
      + `🔥 Sequência atual: ${streak} dia(s)\n\n`
      + `_Abra o app para análise completa!_`;

  // ── Comando: ajuda ───────────────────────────────────
  } else if (['ajuda', 'help', 'comandos', 'oi', 'olá', 'ola'].includes(body)) {
    reply = `🤖 *FitAI — Comandos disponíveis:*\n\n`
      + `✅ *SIM* — registrar treino feito\n`
      + `❌ *NÃO* — registrar falta\n`
      + `⚖️ *112.5* — registrar peso (qualquer número)\n`
      + `📊 *STATUS* — ver seu resumo\n`
      + `❓ *AJUDA* — ver esta lista\n\n`
      + `_Abra o FitAI para mais detalhes!_`;

  // ── Mensagem não reconhecida ─────────────────────────
  } else {
    reply = `🤖 Não entendi. Responda *AJUDA* para ver os comandos disponíveis.`;
  }

  // Responde via Twilio
  if (reply) {
    await sendWA(from, reply);
  }

  // Twilio espera um 200 com TwiML vazio
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ── API — consultada pelo app FitAI ─────────────────────

// GET /api/checkins — retorna todos os check-ins
app.get('/api/checkins', (req, res) => {
  res.json({ checkins: store.checkins });
});

// POST /api/checkins — registra check-in direto do app
app.post('/api/checkins', (req, res) => {
  const { date, done } = req.body;
  if (!date || done === undefined) return res.status(400).json({ error: 'date e done obrigatórios' });
  store.checkins[date] = done;
  res.json({ ok: true, checkins: store.checkins });
});

// GET /api/weight — retorna histórico de peso
app.get('/api/weight', (req, res) => {
  res.json({ weightLog: store.weightLog });
});

// POST /api/weight — registra peso direto do app
app.post('/api/weight', (req, res) => {
  const { date, kg } = req.body;
  if (!date || !kg) return res.status(400).json({ error: 'date e kg obrigatórios' });
  const entry = { date, kg: parseFloat(kg) };
  const existing = store.weightLog.findIndex(l => l.date === date);
  if (existing >= 0) store.weightLog[existing] = entry;
  else store.weightLog.push(entry);
  res.json({ ok: true, weightLog: store.weightLog });
});

// GET /api/status — health check
app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    streak: calcStreak(store.checkins),
    lastWeight: store.weightLog[store.weightLog.length - 1] || null,
    totalCheckins: Object.values(store.checkins).filter(Boolean).length,
    uptime: process.uptime(),
  });
});

// POST /api/trigger-weight-prompt — Make.com chama isso no domingo
app.post('/api/trigger-weight-prompt', async (req, res) => {
  store.pendingInput = 'weight';
  await sendWA(MY_NUMBER,
    `⚖️ *FitAI — Pesagem semanal!*\n\nBom domingo, Raphael! 🌅\n\nQual seu peso hoje? Responda aqui com o número.\nExemplo: *112.5*`
  );
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 FitAI Server rodando na porta ${PORT}`);
  console.log(`📱 Webhook WhatsApp: POST /webhook/whatsapp`);
  console.log(`🔗 API: GET /api/status`);
});
