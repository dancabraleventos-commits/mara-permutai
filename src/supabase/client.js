const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ═══════════════════════════════════════
// LEADS
// ═══════════════════════════════════════

async function getLead(telefone) {
  const tel = telefone.replace(/\D/g, '');
  const { data } = await supabase
    .from('leads_prospeccao')
    .select('*')
    .or(`telefone.eq.${tel},telefone.eq.55${tel}`)
    .maybeSingle();
  return data;
}

async function upsertLead(telefone, updates) {
  const tel = telefone.replace(/\D/g, '');
  const { data: existing } = await supabase
    .from('leads_prospeccao')
    .select('id')
    .or(`telefone.eq.${tel},telefone.eq.55${tel}`)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('leads_prospeccao')
      .update({ ...updates, updated_at: new Date() })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('leads_prospeccao')
      .insert({ telefone: tel, ...updates });
  }
}

async function salvarHistorico(telefone, role, content) {
  const lead = await getLead(telefone);
  if (!lead) return;

  let historico = lead.historico || [];
  historico.push({ role, content });
  if (historico.length > 20) historico = historico.slice(-20);

  await supabase
    .from('leads_prospeccao')
    .update({ historico })
    .eq('id', lead.id);
}

async function getLeadsPendentesFollowup() {
  const agora = new Date();
  const { data } = await supabase
    .from('leads_prospeccao')
    .select('*')
    .eq('respondeu', false)
    .neq('status', 'convertido')
    .neq('status', 'sem_resposta')
    .not('proxima_tentativa', 'is', null)
    .lte('proxima_tentativa', agora.toISOString());
  return data || [];
}

module.exports = { supabase, getLead, upsertLead, salvarHistorico, getLeadsPendentesFollowup };
