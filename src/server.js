const express = require('express');
const { handleEvolutionWebhook } = require('./webhooks/evolution');
const { dispararPrimeiraMensagem, enviarFollowUp } = require('./mara/engine');
const { getLeadsPendentesFollowup, getLeadsNovos } = require('./supabase/client');

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
// DISPARAR MENSAGEM PARA UM LEAD (manual)
// Mantido para testes e disparos pontuais
// ═══════════════════════════════════════
app.post('/disparar', async (req, res) => {
  try {
    const { telefone, nome, tipo, cidade, indicado_por } = req.body;

    if (!telefone || !nome || !tipo) {
      return res.status(400).json({ error: 'telefone, nome e tipo são obrigatórios' });
    }

    await dispararPrimeiraMensagem({ telefone, nome, tipo, cidade, indicado_por });
    res.json({ status: 'ok', mensagem: `Mensagem disparada para ${nome}` });
  } catch (err) {
    console.error('Erro ao disparar:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════
// PROCESSAR FOLLOW-UPS (manual/forçado)
// ═══════════════════════════════════════
app.post('/followups/processar', async (req, res) => {
  res.status(200).json({ status: 'processando' });
  await processarFollowUps();
});

// ═══════════════════════════════════════
// CRON INTERNO — roda a cada 30 minutos
// ═══════════════════════════════════════

const LIMITE_POR_RODADA = 3;
const DELAY_ENTRE_DISPAROS_MS = 12000; // 12s entre cada disparo
let cronRodando = false;

async function dispararLeadsNovos() {
  if (cronRodando) {
    console.log('⏳ Cron já em execução — pulando rodada');
    return;
  }

  // Só dispara em horário comercial: 8h–19h (horário de Brasília = UTC-3)
  const agora = new Date();
  const horaBrasilia = (agora.getUTCHours() - 3 + 24) % 24;
  if (horaBrasilia < 8 || horaBrasilia >= 19) {
    console.log(`🌙 Fora do horário comercial (${horaBrasilia}h) — cron suspenso`);
    return;
  }

  cronRodando = true;
  try {
    const leads = await getLeadsNovos(LIMITE_POR_RODADA);

    if (leads.length === 0) {
      console.log('📭 Nenhum lead novo para disparar');
      return;
    }

    console.log(`🚀 Disparando ${leads.length} lead(s) novos`);

    for (const lead of leads) {
      try {
        await dispararPrimeiraMensagem({
          telefone:    lead.telefone,
          nome:        lead.nome,
          tipo:        lead.tipo,
          cidade:      lead.cidade,
          indicado_por: lead.indicado_por || null
        });
        console.log(`✅ Disparado: ${lead.nome} (${lead.telefone})`);
      } catch (err) {
        console.error(`❌ Erro ao disparar ${lead.nome}:`, err.message);
      }

      // Delay entre disparos para preservar o número
      await new Promise(r => setTimeout(r, DELAY_ENTRE_DISPAROS_MS));
    }

  } catch (err) {
    console.error('❌ Erro no cron de disparos:', err.message);
  } finally {
    cronRodando = false;
  }
}

async function processarFollowUps() {
  try {
    const leads = await getLeadsPendentesFollowup();
    console.log(`📋 ${leads.length} leads para follow-up`);

    for (const lead of leads) {
      await enviarFollowUp(lead);
      await new Promise(r => setTimeout(r, 5000)); // 5s entre follow-ups
    }

    console.log('✅ Follow-ups processados');
  } catch (err) {
    console.error('Erro nos follow-ups:', err.message);
  }
}

// Intervalo: 30 minutos
const INTERVALO_MS = 30 * 60 * 1000;

setInterval(dispararLeadsNovos, INTERVALO_MS);
setInterval(processarFollowUps, INTERVALO_MS);

// Roda uma vez na inicialização após 30s (deixa o servidor estabilizar)
setTimeout(() => {
  console.log('🔁 Primeira rodada do cron em 30s...');
  dispararLeadsNovos();
  processarFollowUps();
}, 30000);

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Mara Permutaí rodando na porta ${PORT}`);
  console.log(`⏰ Cron: 3 disparos a cada 30min | horário 8h–19h BRT`);
});
