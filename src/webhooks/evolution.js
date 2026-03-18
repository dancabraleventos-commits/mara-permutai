const { processarMensagem } = require('../mara/engine');
const { getLead } = require('../supabase/client');

async function handleEvolutionWebhook(req, res) {
  res.status(200).send('ok');

  try {
    const body = req.body;
    const telefone = body.data?.key?.remoteJid || body.from || '';
    const mensagem = body.data?.message?.conversation ||
                     body.data?.message?.extendedTextMessage?.text ||
                     body.text?.message || '';
    const fromMe = body.data?.key?.fromMe || body.fromMe;

    if (!mensagem || fromMe === true) return;
    if (telefone.includes('@g.us') || telefone.includes('-')) return;

    const telefoneLimpo = telefone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    console.log(`📩 Mensagem de ${telefoneLimpo}: ${mensagem.substring(0, 50)}`);

    // Só processa se o lead está na base — Mara não responde estranhos
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
