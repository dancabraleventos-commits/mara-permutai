const { processarMensagem } = require('../mara/engine');
const { getLead } = require('../supabase/client');
const axios = require('axios');
const FormData = require('form-data');

// ═══════════════════════════════════════
// PROTEÇÃO ANTI-AUTOMAÇÃO
// Ignora mensagens que chegam com menos de 8s do envio anterior
// ═══════════════════════════════════════
const ultimaMensagemPorTelefone = new Map();

function isAutomacao(telefoneLimpo, timestampMs) {
  const ultima = ultimaMensagemPorTelefone.get(telefoneLimpo);
  if (!ultima) return false;
  return (timestampMs - ultima) / 1000 < 8;
}

// ═══════════════════════════════════════
// TRANSCRIÇÃO DE ÁUDIO VIA GROQ WHISPER
// ═══════════════════════════════════════
async function transcreverAudio(base64Audio, mimetype = 'audio/ogg') {
  try {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      console.warn('⚠️ GROQ_API_KEY não configurada — áudio ignorado');
      return null;
    }

    const buffer = Buffer.from(base64Audio, 'base64');

    const ext = mimetype.includes('ogg')  ? 'ogg'
              : mimetype.includes('mp4')  ? 'mp4'
              : mimetype.includes('mpeg') ? 'mp3'
              : mimetype.includes('webm') ? 'webm'
              : 'ogg';

    const form = new FormData();
    form.append('file', buffer, {
      filename: `audio.${ext}`,
      contentType: mimetype
    });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        timeout: 30000
      }
    );

    const texto = typeof response.data === 'string'
      ? response.data.trim()
      : response.data?.text?.trim();

    if (!texto) return null;

    console.log(`🎙️ Transcrito: "${texto.substring(0, 80)}"`);
    return texto;

  } catch (err) {
    console.error('❌ Groq erro:', err.response?.data || err.message);
    return null;
  }
}

// ═══════════════════════════════════════
// WEBHOOK PRINCIPAL
// ═══════════════════════════════════════
async function handleEvolutionWebhook(req, res) {
  res.status(200).send('ok');

  try {
    const body = req.body;

    const telefone  = body.data?.key?.remoteJid || body.from || '';
    const fromMe    = body.data?.key?.fromMe || body.fromMe;
    const timestamp = body.data?.messageTimestamp || body.timestamp || Date.now() / 1000;

    if (fromMe === true) return;
    if (telefone.includes('@g.us') || telefone.includes('-')) return;

    const telefoneLimpo = telefone
      .replace('@s.whatsapp.net', '')
      .replace(/\D/g, '');

    if (!telefoneLimpo || telefoneLimpo.length < 10) return;

    // ── Anti-automação ────────────────────────────────────
    const tsMs = typeof timestamp === 'number' && timestamp < 1e12
      ? timestamp * 1000
      : timestamp;

    if (isAutomacao(telefoneLimpo, tsMs)) {
      console.log(`🤖 Automação ignorada: ${telefoneLimpo}`);
      return;
    }
    ultimaMensagemPorTelefone.set(telefoneLimpo, tsMs);

    if (ultimaMensagemPorTelefone.size > 500) {
      const agora = Date.now();
      for (const [tel, ts] of ultimaMensagemPorTelefone.entries()) {
        if (agora - ts > 3600000) ultimaMensagemPorTelefone.delete(tel);
      }
    }

    // ── Extrai mensagem ───────────────────────────────────
    let mensagem = body.data?.message?.conversation ||
                   body.data?.message?.extendedTextMessage?.text ||
                   body.text?.message || '';

    // Áudio (PTT = gravado no WhatsApp, audioMessage = arquivo enviado)
    if (!mensagem) {
      const audioMsg = body.data?.message?.audioMessage ||
                       body.data?.message?.pttMessage;

      if (audioMsg) {
        const base64   = audioMsg.base64 || audioMsg.data;
        const mimetype = audioMsg.mimetype || 'audio/ogg; codecs=opus';

        if (base64) {
          const transcricao = await transcreverAudio(base64, mimetype);
          mensagem = transcricao
            ? `[ÁUDIO TRANSCRITO] ${transcricao}`
            : '[ÁUDIO TRANSCRITO] (transcrição indisponível — peça ao lead para repetir por texto)';
        } else {
          console.log(`⚠️ Áudio sem base64 — ative Webhook Base64 na Evolution`);
          return;
        }
      }
    }

    if (!mensagem) return;

    console.log(`📩 ${telefoneLimpo}: ${mensagem.substring(0, 80)}`);

    // ── Só responde leads conhecidos ──────────────────────
    const lead = await getLead(telefoneLimpo);
    if (!lead) {
      console.log(`⚠️ Desconhecido: ${telefoneLimpo} — ignorando`);
      return;
    }

    await processarMensagem(telefoneLimpo, mensagem);

  } catch (err) {
    console.error('❌ Erro no webhook:', err.message, err.stack);
  }
}

module.exports = { handleEvolutionWebhook };
