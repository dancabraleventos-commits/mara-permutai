const { processarMensagem } = require('../mara/engine');
const { getLead } = require('../supabase/client');

// ═══════════════════════════════════════
// PROTEÇÃO ANTI-AUTOMAÇÃO
// Ignora mensagens que chegam com menos de 8s do envio anterior
// do mesmo número — padrão de bots e automações
// ═══════════════════════════════════════
const ultimaMensagemPorTelefone = new Map();

function isAutomacao(telefoneLimpo, timestampMsg) {
  const ultima = ultimaMensagemPorTelefone.get(telefoneLimpo);
  if (!ultima) return false;
  const diffSegundos = (timestampMsg - ultima) / 1000;
  return diffSegundos < 8;
}

async function handleEvolutionWebhook(req, res) {
  res.status(200).send('ok');

  try {
    const body = req.body;

    // ── Extrai dados da mensagem ──────────────────────────
    const telefone  = body.data?.key?.remoteJid || body.from || '';
    const fromMe    = body.data?.key?.fromMe || body.fromMe;
    const timestamp = body.data?.messageTimestamp || body.timestamp || Date.now() / 1000;

    // Mensagem de texto normal
    let mensagem = body.data?.message?.conversation ||
                   body.data?.message?.extendedTextMessage?.text ||
                   body.text?.message || '';

    // Áudio transcrito — vem como audioMessage com transcrição injetada
    const audioTranscricao = body.data?.message?.audioMessage?.transcription ||
                             body.transcricao || '';
    if (!mensagem && audioTranscricao) {
      mensagem = `[ÁUDIO TRANSCRITO] ${audioTranscricao}`;
    }

    // ── Filtros básicos ───────────────────────────────────
    if (!mensagem || fromMe === true) return;
    if (telefone.includes('@g.us') || telefone.includes('-')) return; // grupos

    const telefoneLimpo = telefone
      .replace('@s.whatsapp.net', '')
      .replace(/\D/g, '');

    if (!telefoneLimpo || telefoneLimpo.length < 10) return;

    // ── Anti-automação: ignora se veio em menos de 8s ────
    const tsMs = typeof timestamp === 'number' && timestamp < 1e12
      ? timestamp * 1000   // unix seconds → ms
      : timestamp;

    if (isAutomacao(telefoneLimpo, tsMs)) {
      console.log(`🤖 Possível automação ignorada: ${telefoneLimpo} (< 8s)`);
      return;
    }

    // Registra timestamp desta mensagem
    ultimaMensagemPorTelefone.set(telefoneLimpo, tsMs);

    // Limpa entradas antigas a cada 500 registros para não vazar memória
    if (ultimaMensagemPorTelefone.size > 500) {
      const agora = Date.now();
      for (const [tel, ts] of ultimaMensagemPorTelefone.entries()) {
        if (agora - ts > 60 * 60 * 1000) { // remove entradas com +1h
          ultimaMensagemPorTelefone.delete(tel);
        }
      }
    }

    console.log(`📩 Mensagem de ${telefoneLimpo}: ${mensagem.substring(0, 60)}`);

    // ── Só processa leads conhecidos ─────────────────────
    const lead = await getLead(telefoneLimpo);
    if (!lead) {
      console.log(`⚠️ Lead desconhecido: ${telefoneLimpo} — ignorando`);
      return;
    }

    await processarMensagem(telefoneLimpo, mensagem);

  } catch (err) {
    console.error('❌ Erro no webhook:', err.message, err.stack);
  }
}

module.exports = { handleEvolutionWebhook };
