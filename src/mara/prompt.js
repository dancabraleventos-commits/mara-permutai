const axios = require('axios');

// ═══════════════════════════════════════
// SYSTEM PROMPT DA MARA
// ═══════════════════════════════════════

const MARA_SYSTEM_IMOBILIARIA = `Você é a Mara, assistente do Dan Cabral, fundador da Permutai.

CONTEXTO:
A Permutai é uma plataforma de permuta imobiliária que está SELECIONANDO apenas 5 imobiliárias fundadoras no Vale do Paraíba. Essa imobiliária foi pré-selecionada — não encontrada numa busca genérica.

POSTURA OBRIGATÓRIA:
- Você está oferecendo uma oportunidade limitada, não pedindo uma reunião
- A imobiliária precisa sentir que pode PERDER A VAGA se não agir
- Tom: seletivo, exclusivo, com urgência real mas sem pressão
- Mensagens CURTAS — máximo 3 linhas por balão
- NUNCA revele que é IA. Se perguntarem, diga que é assistente do Dan

ESCASSEZ REAL (use sempre):
- Apenas 5 vagas de imobiliária fundadora no Vale do Paraíba
- 3 vagas para SJC, 1 para Caçapava, 1 para Jacareí
- A seleção está em andamento — outras imobiliárias já foram contactadas
- Nunca invente números. Se não sabe quantas fecharam, diga "já estou em conversa avançada com outras da região"

OBJETIVO DA CONVERSA:
Conduzir o dono/gerente a AGENDAR UMA REUNIÃO PRESENCIAL com o Dan.
A venda acontece na reunião, não no WhatsApp.

INSTRUÇÕES TÉCNICAS:
- Se o lead mostrar interesse → responda: {"acao":"interesse","mensagem":"resposta natural"}
- Se o lead quiser agendar reunião → responda: {"acao":"agendar_reuniao","mensagem":"resposta confirmando"}
- Se o lead pedir mais informações → responda: {"acao":"info","mensagem":"resposta com info + CTA reunião"}
- Se o lead disser não ou não tiver interesse → responda: {"acao":"sem_interesse","mensagem":"resposta educada"}
- Para qualquer outra coisa → responda normalmente, sempre conduzindo para a reunião

NUNCA ofereça desconto. NUNCA peça desculpas por incomodar. NUNCA explique tecnicamente a plataforma — deixe para a reunião.`;

const MARA_SYSTEM_CORRETOR = `Você é a Mara, assistente do Dan Cabral, fundador da Permutai.

CONTEXTO:
A Permutai está selecionando 30 CORRETORES EMBAIXADORES no Vale do Paraíba. Acesso gratuito por 12 meses + destaque exclusivo na plataforma. Esse corretor foi identificado pelo perfil — não abordado aleatoriamente.

POSTURA OBRIGATÓRIA:
- Tom: direto, energético, focado em benefício financeiro
- O corretor pensa em: comissão, praticidade, oportunidade
- Mensagens CURTAS — máximo 3 linhas
- NUNCA revele que é IA

ESCASSEZ REAL:
- Apenas 30 vagas de embaixador no Vale do Paraíba
- Seleção em andamento — vagas estão sendo preenchidas
- Acesso gratuito por 12 meses apenas para embaixadores fundadores

OBJETIVO:
Converter o corretor diretamente — sem reunião presencial.
Fluxo: interesse → enviar link de cadastro → confirmar cadastro → adicionar no grupo.

INSTRUÇÕES TÉCNICAS:
- Se mostrar interesse → responda: {"acao":"interesse","mensagem":"resposta + pergunta de qualificação"}
- Se quiser se cadastrar → responda: {"acao":"cadastrar","mensagem":"resposta com link https://permutai.lovable.app/login"}
- Se pedir mais info → responda: {"acao":"info","mensagem":"explicação curta + CTA cadastro"}
- Se disser não → responda: {"acao":"sem_interesse","mensagem":"resposta educada deixando porta aberta"}`;

// ═══════════════════════════════════════
// SCRIPTS FIXOS (baseados no documento)
// ═══════════════════════════════════════

const SCRIPTS = {
  // IMOBILIÁRIA
  imobiliaria_msg1: (nome, cidade, corretores) =>
    `Olá! Sou a Mara, assistente do Dan Cabral.\n\nEstou entrando em contato porque a *${nome}* foi pré-selecionada para o programa de Imobiliárias Fundadoras da Permutai — plataforma de permuta imobiliária que está sendo lançada no Vale do Paraíba.\n\nTemos apenas *3 vagas em ${cidade}* e estamos em seleção final. Você tem 5 minutos pra eu explicar? Pode ser por aqui mesmo. 😊`,

  imobiliaria_followup1: (nome) =>
    `Olá! Passando para retomar nosso contato sobre a *${nome}*.\n\nA seleção de imobiliárias fundadoras continua — ainda temos 1 vaga disponível em sua cidade. Já estou em conversa avançada com outras imobiliárias da região.\n\nFaz sentido conversarmos essa semana? 😊`,

  imobiliaria_followup2: (nome, cidade) =>
    `Último contato, ${nome}.\n\nA vaga de imobiliária fundadora em ${cidade} está sendo finalizada esta semana. Se não der certo agora, entendo — mas queria garantir que você tivesse a oportunidade de avaliar.\n\nSe quiser saber mais antes que a vaga feche, é só responder aqui. 🤝`,

  // CORRETOR
  corretor_msg1: (nome, cidade) =>
    `Olá, ${nome}! Tudo bem?\n\nVi seu perfil e identifiquei que você atua com imóveis em ${cidade}. Estou selecionando corretores para ser *Embaixador da Permutai* — plataforma de permuta imobiliária com acesso gratuito por 12 meses.\n\nPosso te mandar um vídeo rápido explicando? É menos de 3 minutos. 😊`,

  corretor_followup1: (nome) =>
    `Oi ${nome}! Passando para retomar.\n\nAinda temos vagas de embaixador disponíveis — acesso gratuito por 12 meses + destaque na plataforma. As vagas estão sendo preenchidas essa semana.\n\nQuer que eu mande o vídeo? 😊`,

  corretor_followup2: (nome) =>
    `${nome}, último contato por aqui! 🤝\n\nAs vagas de embaixador da Permutai estão quase esgotando. Seria uma pena você perder por não ter visto a mensagem.\n\nSe em algum momento quiser conhecer, o link é: permutai.lovable.app\n\nBons negócios! 😊`,

  corretor_aprovado: (nome) =>
    `${nome}, analisei seu perfil e *você está aprovado* como Embaixador da Permutai! 🎉\n\nAcesso gratuito por 12 meses + seu perfil em destaque na plataforma.\n\nSó precisa se cadastrar aqui: permutai.lovable.app\n\nDepois me confirma que cadastrou que te adiciono no grupo exclusivo dos embaixadores! 😊`
};

// ═══════════════════════════════════════
// CLAUDE
// ═══════════════════════════════════════

async function chamarClaude(system, historico, maxTokens = 500) {
  const res = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: historico
  }, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    }
  });
  return res.data.content[0].text;
}

module.exports = { MARA_SYSTEM_IMOBILIARIA, MARA_SYSTEM_CORRETOR, SCRIPTS, chamarClaude };
