const express = require('express');
const { handleEvolutionWebhook } = require('./webhooks/evolution');
const { dispararPrimeiraMensagem, enviarFollowUp } = require('./mara/engine');
const { getLeadsPendentesFollowup } = require('./supabase/client');

const app = express();
app.use(express.json());

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mara-permutai' });
});

// ═══════════════════════════════════════
// WEBHOOK — recebe mensagens WhatsApp
// ═══════════════════════════════════════
app.post('/webhooks/evolution', handleEvolutionWebhook);

// ═══════════════════════════════════════
// DISPARAR MENSAGEM PARA UM LEAD
// Chamado pelo n8n após filtrar o Outscraper
// ═══════════════════════════════════════
app.post('/disparar', async (req, res) => {
  try {
    const { telefone, nome, tipo, cidade, corretores } = req.body;

    if (!telefone || !nome || !tipo) {
      return res.status(400).json({ error: 'telefone, nome e tipo são obrigatórios' });
    }

    await dispararPrimeiraMensagem({ telefone, nome, tipo, cidade, corretores });
    res.json({ status: 'ok', mensagem: `Mensagem disparada para ${nome}` });
  } catch (err) {
    console.error('Erro ao disparar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// PROCESSAR FOLLOW-UPS PENDENTES
// Chamado diariamente pelo n8n
// ═══════════════════════════════════════
app.post('/followups/processar', async (req, res) => {
  res.status(200).json({ status: 'processando' });

  try {
    const leads = await getLeadsPendentesFollowup();
    console.log(`📋 ${leads.length} leads para follow-up`);

    for (const lead of leads) {
      await enviarFollowUp(lead);
      await new Promise(r => setTimeout(r, 2000)); // 2s entre envios
    }

    console.log(`✅ Follow-ups processados`);
  } catch (err) {
    console.error('Erro nos follow-ups:', err.message);
  }
});

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mara PermuteAI rodando na porta ${PORT}`);
});
