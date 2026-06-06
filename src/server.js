const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// ── Supabase ────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL     || 'https://oajmibjuzltiryqdrddk.supabase.co',
  process.env.SUPABASE_SERVICE_KEY // service_role key (env var no Render)
);

// ── Twilio ──────────────────────────────────────────────
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const MY_NUMBER   = process.env.MY_WHATSAPP_NUMBER;
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

// Estado de conversa em memória (só precisa durar a sessão)
let pendingInput = null;

// ── Helpers ─────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }

function formatDate(d) { const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; }

async function sendWA(to, body) {
  try { await twilioClient.messages.create({ from: FROM_NUMBER, to, body }); }
  catch(e) { console.error('Twilio error:', e.message); }
}

// ── DB helpers ───────────────────────────────────────────
async function getCheckins() {
  const { data } = await supabase.from('checkins').select('*').order('date', { ascending: true });
  const map = {};
  (data || []).forEach(r => { map[r.date] = r.done; });
  return map;
}

async function saveCheckin(date, done) {
  await supabase.from('checkins').upsert({ date, done }, { onConflict: 'date' });
}

async function getWeightLog() {
  const { data } = await supabase.from('weight_log').select('*').order('date', { ascending: true });
  return (data || []).map(r => ({ date: r.date, kg: r.kg }));
}

async function saveWeight(date, kg) {
  await supabase.from('weight_log').upsert({ date, kg: parseFloat(kg) }, { onConflict: 'date' });
}

async function calcStreak() {
  const checkins = await getCheckins();
  let streak = 0;
  const now = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const key = d.toISOString().split('T')[0];
    if (checkins[key] === true) streak++;
    else if (checkins[key] === false) break;
  }
  return streak;
}

// ── PROXY Gemini AI ──────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  try {
    const { system, messages, max_tokens = 1000 } = req.body;
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system || '' }] },
          contents,
          generationConfig: { maxOutputTokens: max_tokens, temperature: 0.7 }
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message });
    res.json({ text: data.candidates?.[0]?.content?.parts?.[0]?.text || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WEBHOOK WhatsApp ─────────────────────────────────────
app.post('/webhook/whatsapp', async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || '').trim().toLowerCase();
  console.log(`📱 ${from}: "${body}"`);

  if (MY_NUMBER && from !== MY_NUMBER) {
    return res.status(200).send('<Response></Response>');
  }

  let reply = '';

  // ── Esperando peso ──────────────────────────────────
  if (pendingInput === 'weight') {
    const kg = parseFloat(body.replace(',', '.'));
    if (!isNaN(kg) && kg > 40 && kg < 300) {
      await saveWeight(today(), kg);
      pendingInput = null;
      const log = await getWeightLog();
      const prev = log.length >= 2 ? log[log.length - 2] : null;
      const diff = prev ? (prev.kg - kg).toFixed(1) : null;
      const diffText = diff
        ? (diff > 0 ? `⬇️ ${diff} kg a menos que a semana passada!`
          : diff < 0 ? `⬆️ ${Math.abs(diff)} kg a mais — bora focar!`
          : '➡️ Peso estável.')
        : '';
      reply = `✅ *Peso registrado: ${kg} kg*\n${diffText}\n\n📊 Abra o FitAI para ver seu gráfico atualizado!`;
    } else {
      reply = '⚠️ Não entendi. Responda com seu peso em kg.\nExemplo: *112.5*';
    }

  // ── SIM ─────────────────────────────────────────────
  } else if (['sim','s','yes','✅','fiz','treinei','👍'].includes(body)) {
    await saveCheckin(today(), true);
    const streak = await calcStreak();
    const streakMsg = streak >= 7 ? `🔥 ${streak} dias seguidos! Você é uma máquina!`
      : streak >= 3 ? `🔥 ${streak} dias consecutivos! Continue assim!`
      : `💪 Treino registrado! ${streak} dia(s) de sequência.`;
    reply = `✅ *Check-in confirmado!*\n\n${streakMsg}\n\nAbra o FitAI para registrar suas cargas 🏋️`;

  // ── NÃO ─────────────────────────────────────────────
  } else if (['nao','não','n','no','❌','nop'].includes(body)) {
    await saveCheckin(today(), false);
    reply = `📝 *Falta registrada.*\n\nNão tem problema! Amanhã é um novo dia 💪`;

  // ── Número = peso direto ─────────────────────────────
  } else if (/^\d{2,3}([.,]\d{1,2})?$/.test(body)) {
    const kg = parseFloat(body.replace(',', '.'));
    if (kg > 40 && kg < 300) {
      await saveWeight(today(), kg);
      reply = `⚖️ *Peso ${kg} kg registrado!*\n\n📊 Abra o FitAI para ver seu progresso.`;
    }

  // ── STATUS ───────────────────────────────────────────
  } else if (['status','resumo','progresso'].includes(body)) {
    const [checkins, log, streak] = await Promise.all([getCheckins(), getWeightLog(), calcStreak()]);
    const lastW = log.length ? log[log.length - 1] : null;
    const now = new Date();
    const weekCheckins = Object.entries(checkins)
      .filter(([d, v]) => v === true && (now - new Date(d)) / 86400000 <= 7).length;
    reply = `📊 *Seu status FitAI:*\n\n`
      + `⚖️ Último peso: ${lastW ? `${lastW.kg} kg (${formatDate(lastW.date)})` : 'não registrado'}\n`
      + `🏋️ Treinos esta semana: ${weekCheckins}\n`
      + `🔥 Sequência atual: ${streak} dia(s)\n\n`
      + `_Abra o app para análise completa!_`;

  // ── AJUDA ────────────────────────────────────────────
  } else if (['ajuda','help','oi','olá','ola','comandos'].includes(body)) {
    reply = `🤖 *FitAI — Comandos:*\n\n`
      + `✅ *SIM* — treino feito\n`
      + `❌ *NÃO* — registrar falta\n`
      + `⚖️ *112.5* — registrar peso\n`
      + `📊 *STATUS* — ver resumo\n`
      + `❓ *AJUDA* — esta lista`;

  } else {
    reply = `🤖 Não entendi. Responda *AJUDA* para ver os comandos.`;
  }

  if (reply) await sendWA(from, reply);
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ── API ──────────────────────────────────────────────────

app.get('/api/checkins', async (req, res) => {
  const checkins = await getCheckins();
  res.json({ checkins });
});

app.post('/api/checkins', async (req, res) => {
  const { date, done } = req.body;
  if (!date || done === undefined) return res.status(400).json({ error: 'date e done obrigatórios' });
  await saveCheckin(date, done);
  res.json({ ok: true });
});

app.get('/api/weight', async (req, res) => {
  const weightLog = await getWeightLog();
  res.json({ weightLog });
});

app.post('/api/weight', async (req, res) => {
  const { date, kg } = req.body;
  if (!date || !kg) return res.status(400).json({ error: 'date e kg obrigatórios' });
  await saveWeight(date, kg);
  res.json({ ok: true });
});

app.get('/api/status', async (req, res) => {
  const [checkins, log, streak] = await Promise.all([getCheckins(), getWeightLog(), calcStreak()]);
  res.json({
    ok: true,
    streak,
    lastWeight: log[log.length - 1] || null,
    totalCheckins: Object.values(checkins).filter(Boolean).length,
    uptime: process.uptime(),
  });
});

app.get('/api/test-twilio', async (req, res) => {
  const mask = (str) => {
    if (!str) return 'not set';
    if (str.length <= 8) return 'set (too short)';
    return `${str.slice(0, 10)}...${str.slice(-4)}`;
  };

  try {
    const from = process.env.TWILIO_FROM_NUMBER;
    const to = process.env.MY_WHATSAPP_NUMBER;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;

    console.log(`Sending test message from ${from} to ${to}...`);
    const result = await twilioClient.messages.create({
      from: from,
      to: to,
      body: '🔔 Teste do FitAI: Seu servidor conseguiu enviar esta mensagem pelo WhatsApp!'
    });

    res.json({
      success: true,
      sid: result.sid,
      status: result.status,
      config: {
        TWILIO_ACCOUNT_SID: mask(sid),
        TWILIO_AUTH_TOKEN: mask(token),
        TWILIO_FROM_NUMBER: from,
        MY_WHATSAPP_NUMBER: mask(to)
      }
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: e.message,
      code: e.code,
      status: e.status,
      config: {
        TWILIO_ACCOUNT_SID: mask(process.env.TWILIO_ACCOUNT_SID),
        TWILIO_AUTH_TOKEN: mask(process.env.TWILIO_AUTH_TOKEN),
        TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
        MY_WHATSAPP_NUMBER: mask(process.env.MY_WHATSAPP_NUMBER)
      }
    });
  }
});

app.get('/api/test-gemini', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'GEMINI_API_KEY env var is not set on the server' });
  }

  const testModel = async (modelName) => {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Respond with "OK"' }] }]
          })
        }
      );
      const data = await response.json();
      return {
        model: modelName,
        status: response.status,
        ok: response.ok,
        response: data
      };
    } catch (e) {
      return {
        model: modelName,
        error: e.message
      };
    }
  };

  const results = await Promise.all([
    testModel('gemini-2.0-flash'),
    testModel('gemini-1.5-flash')
  ]);

  res.json({
    success: results.some(r => r.ok),
    results
  });
});

app.post('/api/trigger-weight-prompt', async (req, res) => {
  pendingInput = 'weight';
  await sendWA(MY_NUMBER,
    `⚖️ *FitAI — Pesagem semanal!*\n\nBom domingo, Raphael! 🌅\n\nQual seu peso hoje?\nResponda com o número. Exemplo: *112.5*`
  );
  res.json({ ok: true });
});

// Salva programa de treino e dieta (do app)
app.post('/api/program', async (req, res) => {
  const { workoutPlan, dietPlan, profile } = req.body;
  await supabase.from('program').upsert({ id: 1, workout_plan: workoutPlan, diet_plan: dietPlan, profile }, { onConflict: 'id' });
  res.json({ ok: true });
});

app.get('/api/program', async (req, res) => {
  const { data } = await supabase.from('program').select('*').eq('id', 1).single();
  res.json(data || {});
});

// Salva cargas
app.post('/api/cargas', async (req, res) => {
  const { date, data } = req.body;
  if (!date || !data) return res.status(400).json({ error: 'date e data obrigatórios' });
  await supabase.from('cargas').upsert({ date, data }, { onConflict: 'date' });
  res.json({ ok: true });
});

app.get('/api/cargas', async (req, res) => {
  const { data } = await supabase.from('cargas').select('*').order('date', { ascending: true });
  const map = {};
  (data || []).forEach(r => { map[r.date] = r.data; });
  res.json({ cargas: map });
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 FitAI Server na porta ${PORT}`);
  console.log(`🗄️  Supabase: ${process.env.SUPABASE_URL || 'https://oajmibjuzltiryqdrddk.supabase.co'}`);
});
