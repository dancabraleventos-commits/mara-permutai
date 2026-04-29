const { MARA_SYSTEM_IMOBILIARIA, MARA_SYSTEM_CORRETOR, SCRIPTS, chamarClaude, processarRespostaMara } = require('./prompt');
const { enviarMensagem, enviarComDelay } = require('../evolution/client');
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

  const tipo            = lead.perfil_tipo || lead.tipo || 'corretor';
  const nome            = lead.nome_contato || lead.nome || '';
  const cidade          = lead.cidade || '';
  const indicadoPor     = lead.indicado_por || null;
  const corretoresAtivos = process.env.CORRETORES_ATIVOS || '?';
  const contadorMsgs    = (lead.contador_mensagens || 0) + 1;

  console.log(`📩 ${tipo} ${nome}: ${mensagem.substring(0, 50)}`);

  // Marca que respondeu + notifica Dan (só na primeira resposta)
  if (!lead.respondeu) {
    await upsertLead(telefone, {
      respondeu: true,
      respondeu_em: new Date(),
      status_lead: 'em_atendimento'
    });
    await notificarDan(telefone, nome, tipo, mensagem);
  }

  // Atualiza contador e timestamp
  await upsertLead(telefone, {
    contador_mensagens: contadorMsgs,
    ultima_interacao: Date.now()
  });

  // Salva mensagem do lead no histórico
  await salvarHistorico(telefone, 'user', mensagem);

  // Busca histórico atualizado
  const leadAtualizado = await getLead(telefone);
  const historico = leadAtualizado?.historico || [];
  const system = tipo === 'imobiliária' || tipo === 'imobiliaria'
    ? MARA_SYSTEM_IMOBILIARIA
    : MARA_SYSTEM_CORRETOR;

  // Injeta contexto do lead no system prompt
  const systemComContexto = `${system}

DADOS DO LEAD (contexto interno — nunca cite diretamente):
Nome: ${nome}
Tipo: ${tipo}
Cidade: ${cidade}
Mensagens trocadas: ${contadorMsgs}${indicadoPor ? `\nIndicado por: ${indicadoPor}` : ''}${tipo === 'corretor' || tipo === 'autônomo' ? `\nCorretores ativos na plataforma: ${corretoresAtivos}` : ''}${leadAtualizado?.resumo_opus ? `\nResumo do perfil: ${leadAtualizado.resumo_opus}` : ''}`;

  // Monta histórico para o Claude (últimas 10 trocas)
  const msgs = historico.slice(-10);
  msgs.push({ role: 'user', content: mensagem });

  // Chama Claude
  const respostaBruta = await chamarClaude(systemComContexto, msgs, 700);

  // Remove <thinking> e extrai <resumo>
  const { mensagem: respostaFinal, resumo } = processarRespostaMara(respostaBruta);

  // Salva resumo se estiver nas primeiras 3 mensagens
  if (resumo && contadorMsgs <= 3) {
    await upsertLead(telefone, { resumo_opus: resumo });
    console.log(`📝 Resumo salvo para ${nome}`);
  }

  // Tenta parsear JSON para ações estruturadas
  let acaoExecutada = false;
  try {
    const parsed = JSON.parse(respostaFinal.replace(/```json|```/g, '').trim());

    if (parsed.abordagem) {
      const converteu = parsed.acao === 'cadastrar' || parsed.acao === 'agendar_reuniao';
      await upsertLead(telefone, {
        abordagem_usada: parsed.abordagem,
        ...(converteu ? { abordagem_converteu: parsed.abordagem } : {})
      });
    }

    if (parsed.acao === 'agendar_reuniao') {
      await upsertLead(telefone, { status_lead: 'reuniao_agendada' });
      await enviarMensagem(telefone, parsed.mensagem);
      await notificarDanReuniao(telefone, nome, cidade);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      acaoExecutada = true;
    }

    if (parsed.acao === 'cadastrar') {
      await upsertLead(telefone, { status_lead: 'convertido' });
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      acaoExecutada = true;
    }

    if (parsed.acao === 'sem_interesse') {
      await upsertLead(telefone, { status_lead: 'lead_frio' });
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      acaoExecutada = true;
    }

    if (!acaoExecutada && parsed.mensagem) {
      await enviarMensagem(telefone, parsed.mensagem);
      await salvarHistorico(telefone, 'assistant', parsed.mensagem);
      acaoExecutada = true;
    }

  } catch (e) {
    // Resposta conversacional — envia direto
  }

  if (!acaoExecutada) {
    await enviarMensagem(telefone, respostaFinal);
    await salvarHistorico(telefone, 'assistant', respostaFinal);
  }
}

// ═══════════════════════════════════════
// DISPARAR PRIMEIRA MENSAGEM
// ═══════════════════════════════════════

async function dispararPrimeiraMensagem(lead) {
  const { telefone, nome, tipo, cidade, indicado_por } = lead;
  const corretoresAtivos = process.env.CORRETORES_ATIVOS || '?';

  let mensagem;
  let abordagemInicial;

  if (tipo === 'imobiliaria' || tipo === 'imobiliária') {
    mensagem = SCRIPTS.imobiliaria_msg1(nome, cidade);
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
    nome_contato:      nome,
    perfil_tipo:       tipo === 'imobiliaria' || tipo === 'imobiliária' ? 'imobiliária' : 'autônomo',
    cidade,
    status_lead:       'em_atendimento',
    tentativas:        1,
    respondeu:         false,
    abordagem_usada:   abordagemInicial,
    historico:         [{ role: 'assistant', content: mensagem }],
    ultima_interacao:  Date.now(),
    proxima_tentativa: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // +3 dias
  });

  console.log(`✅ Msg1 → ${tipo} ${nome} (${telefone}) — abordagem: ${abordagemInicial}`);
}

// ═══════════════════════════════════════
// FOLLOW UP AUTOMÁTICO
// ═══════════════════════════════════════

async function enviarFollowUp(lead) {
  const { telefone, nome, tipo, cidade, tentativas } = lead;
  const numTentativa = Number(tentativas || 1);

  if (numTentativa >= 3) {
    await upsertLead(telefone, { status_lead: 'lead_frio', proxima_tentativa: null });
    console.log(`🔚 ${nome} → lead_frio após ${numTentativa} tentativas`);
    return;
  }

  let mensagem;
  if (tipo === 'imobiliaria' || tipo === 'imobiliária') {
    mensagem = numTentativa === 1
      ? SCRIPTS.imobiliaria_followup1(nome)
      : SCRIPTS.imobiliaria_followup2(nome, cidade);
  } else {
    mensagem = numTentativa === 1
      ? SCRIPTS.corretor_followup1(nome, cidade)
      : SCRIPTS.corretor_followup2(nome);
  }

  await enviarMensagem(telefone, mensagem);

  const proximaTentativa = numTentativa === 1
    ? new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)
    : null;

  await upsertLead(telefone, {
    tentativas:        numTentativa + 1,
    status_lead:       numTentativa >= 2 ? 'lead_frio' : 'em_atendimento',
    proxima_tentativa: proximaTentativa,
    historico: [...(lead.historico || []), { role: 'assistant', content: mensagem }]
  });

  console.log(`✅ Follow-up ${numTentativa + 1} → ${nome}`);
}

// ═══════════════════════════════════════
// NOTIFICAÇÕES PARA O DAN
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
