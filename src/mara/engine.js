const { MARA_SYSTEM_IMOBILIARIA, MARA_SYSTEM_CORRETOR, SCRIPTS, chamarClaude } = require('./prompt');
const { enviarMensagem, enviarComDelay, delay } = require('../evolution/client');
const { getLead, upsertLead, salvarHistorico } = require('../supabase/client');

// ═══════════════════════════════════════
// PROCESSAR RESPOSTA DO LEAD
// ═══════════════════════════════════════

async function processarMensagem(telefone, mensagem) {
  const lead = await getLead(telefone);
  if (!lead) {
    console.log(`⚠️ Lead não encontrado: ${telefone}`);
    return;
  }

  const tipo = lead.tipo; // 'imobiliaria' ou 'corretor'
  const nome = lead.nome || '';
  const cidade = lead.cidade || '';
  const indicadoPor = lead.indicado_por || null;
  const corretoresAtivos = process.env.CORRETORES_ATIVOS || '?';

  console.log(`📩 ${tipo} ${nome}: ${mensagem.substring(0, 50)}`);

  // Marcar que respondeu + notificar Dan
  if (!lead.respondeu) {
    await upsertLead(telefone, { respondeu: true, respondeu_em: new Date(), status: 'respondeu' });
    await notificarDan(telefone, nome, tipo, mensagem);
  }

  // Salvar no histórico
  await salvarHistorico(telefone, 'user', mensagem);

  // Buscar histórico atualizado
  const leadAtualizado = await getLead(telefone);
  const historico = leadAtualizado?.historico || [];
  const system = tipo === 'imobiliaria' ? MARA_SYSTEM_IMOBILIARIA : MARA_SYSTEM_CORRETOR;

  // Adicionar contexto do lead — inclui indicação e corretores ativos para o corretor
  const systemComContexto = `${system}

DADOS DO LEAD:
Nome: ${nome}
Tipo: ${tipo}
Cidade: ${cidade}
Tentativas de contato: ${lead.tentativas || 1}${indicadoPor ? `\nIndicado por: ${indicadoPor}` : ''}${tipo === 'corretor' ? `\nCorretores ativos na plataforma: ${corretoresAtivos}` : ''}`;

  // Claude interpreta e responde
  const msgs = historico.slice(-10);
  msgs.push({ role: 'user', content: mensagem });

  const resposta = await chamarClaude(systemComContexto, msgs, 400);

  // Verificar se é uma ação
  try {
    const parsed = JSON.parse(resposta.replace(/```json|```/g, '').trim());

    // Registrar abordagem usada se presente
    if (parsed.abordagem) {
      const jaConverteu = parsed.acao === 'cadastrar' || parsed.acao === 'agendar_reuniao';
      await upsertLead(telefone, {
        abordagem_usada: parsed.abordagem,
        ...(jaConverteu ? { abordagem_converteu: parsed.abordagem } : {})
      });
    }

    if (parsed.acao === 'agendar_reuniao') {
      await upsertLead(telefone, { status: 'agendando_reuniao' });
      await enviarMensagem(telefone, parsed.mensagem);
      await notificarDanReuniao(telefone, nome, cidade);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      return;
    }

    if (parsed.acao === 'cadastrar') {
      await upsertLead(telefone, { status: 'link_enviado' });
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      return;
    }

    if (parsed.acao === 'sem_interesse') {
      await upsertLead(telefone, { status: 'sem_interesse' });
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      return;
    }

    // Qualquer outra ação — envia a mensagem normalmente
    if (parsed.mensagem) {
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      return;
    }

  } catch (e) {
    // Não é JSON — resposta conversacional
  }

  await enviarMensagem(telefone, resposta);
  await salvarHistorico(telefone, 'assistant', resposta);
}

// ═══════════════════════════════════════
// DISPARAR PRIMEIRA MENSAGEM
// ═══════════════════════════════════════

async function dispararPrimeiraMensagem(lead) {
  const { telefone, nome, tipo, cidade, corretores, indicado_por } = lead;
  const corretoresAtivos = process.env.CORRETORES_ATIVOS || corretores || '?';

  let mensagem;
  let abordagemInicial;

  if (tipo === 'imobiliaria') {
    mensagem = SCRIPTS.imobiliaria_msg1(nome, cidade, corretores);
    abordagemInicial = 'frio';
  } else if (indicado_por) {
    mensagem = SCRIPTS.corretor_msg1_indicacao(nome, indicado_por, corretoresAtivos);
    abordagemInicial = 'indicacao';
  } else {
    mensagem = SCRIPTS.corretor_msg1(nome, cidade);
    abordagemInicial = 'frio';
  }

  await enviarMensagem(telefone, mensagem);
  await upsertLead(telefone, {
    nome,
    tipo,
    cidade,
    status: 'msg1_enviada',
    tentativas: 1,
    respondeu: false,
    abordagem_usada: abordagemInicial,
    historico: [{ role: 'assistant', content: mensagem }],
    proxima_tentativa: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // +3 dias
  });

  console.log(`✅ Msg1 enviada para ${tipo} ${nome} (${telefone}) — abordagem: ${abordagemInicial}`);
}

// ═══════════════════════════════════════
// FOLLOW UP AUTOMÁTICO
// ═══════════════════════════════════════

async function enviarFollowUp(lead) {
  const { telefone, nome, tipo, cidade, tentativas } = lead;
  const numTentativa = Number(tentativas || 1);

  if (numTentativa >= 3) {
    await upsertLead(telefone, { status: 'sem_resposta', proxima_tentativa: null });
    return;
  }

  let mensagem;
  if (tipo === 'imobiliaria') {
    mensagem = numTentativa === 1
      ? SCRIPTS.imobiliaria_followup1(nome)
      : SCRIPTS.imobiliaria_followup2(nome, cidade);
  } else {
    mensagem = numTentativa === 1
      ? SCRIPTS.corretor_followup1(nome)
      : SCRIPTS.corretor_followup2(nome); // Framework 3 — fechamento
  }

  await enviarMensagem(telefone, mensagem);

  const proximaTentativa = numTentativa === 1
    ? new Date(Date.now() + 4 * 24 * 60 * 60 * 1000) // +4 dias
    : null; // Última tentativa — sem próxima

  await upsertLead(telefone, {
    tentativas: numTentativa + 1,
    status: numTentativa >= 2 ? 'ultimo_followup' : 'followup1_enviado',
    abordagem_usada: tipo === 'corretor' && numTentativa >= 2 ? 'fechamento' : undefined,
    proxima_tentativa: proximaTentativa,
    historico: [...(lead.historico || []), { role: 'assistant', content: mensagem }]
  });

  console.log(`✅ Follow-up ${numTentativa + 1} enviado para ${nome}`);
}

// ═══════════════════════════════════════
// NOTIFICAR DAN
// ═══════════════════════════════════════

async function notificarDan(telefone, nome, tipo, mensagem) {
  const danPhone = process.env.DAN_PHONE;
  if (!danPhone) return;
  await enviarMensagem(danPhone,
    `📲 *Resposta recebida!*\n\n👤 ${nome} (${tipo})\n📱 ${telefone}\n\n💬 "${mensagem.substring(0, 100)}"\n\nA Mara está respondendo automaticamente.`
  );
}

async function notificarDanReuniao(telefone, nome, cidade) {
  const danPhone = process.env.DAN_PHONE;
  if (!danPhone) return;
  await enviarMensagem(danPhone,
    `🎯 *Reunião solicitada!*\n\n👤 ${nome}\n📍 ${cidade}\n📱 ${telefone}\n\nEle quer agendar reunião! Confirme o horário diretamente com ele. 💪`
  );
}

module.exports = { processarMensagem, dispararPrimeiraMensagem, enviarFollowUp };
