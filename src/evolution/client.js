const axios = require('axios');

// ═══════════════════════════════════════
// DELAY UTILITÁRIO
// ═══════════════════════════════════════

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════
// SIMULA "DIGITANDO..." NA EVOLUTION API
// Proporcional ao tamanho da mensagem: 4–8 segundos
// ═══════════════════════════════════════

async function simularDigitando(telefone, texto) {
  try {
    // Calcula delay: ~50ms por caractere, entre 4s e 8s
    const chars = (texto || '').length;
    const ms = Math.min(Math.max(chars * 50, 4000), 8000);

    const url = `${process.env.EVOLUTION_API_URL}/chat/updatePresence/${process.env.EVOLUTION_INSTANCE}`;
    await axios.post(url,
      { number: telefone, presence: 'composing' },
      { headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );

    await delay(ms);

    // Para o "digitando" antes de enviar
    await axios.post(url,
      { number: telefone, presence: 'available' },
      { headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    // Se a API não suportar presence, apenas faz o delay
    const chars = (texto || '').length;
    const ms = Math.min(Math.max(chars * 50, 4000), 8000);
    await delay(ms);
    console.warn('⚠️ Presence não disponível — usando delay simples');
  }
}

// ═══════════════════════════════════════
// ENVIAR MENSAGEM COM DIGITANDO
// ═══════════════════════════════════════

async function enviarMensagem(telefone, texto) {
  try {
    // Simula digitando antes de enviar
    await simularDigitando(telefone, texto);

    const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
    await axios.post(url,
      { number: telefone, text: texto },
      { headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('❌ Erro Evolution:', e.message);
  }
}

// ═══════════════════════════════════════
// ENVIAR MÚLTIPLAS MENSAGENS EM SEQUÊNCIA
// ═══════════════════════════════════════

async function enviarComDelay(telefone, mensagens) {
  for (let i = 0; i < mensagens.length; i++) {
    await enviarMensagem(telefone, mensagens[i]); // já inclui o digitando
    if (i < mensagens.length - 1) await delay(1500); // pausa entre balões
  }
}

module.exports = { enviarMensagem, enviarComDelay, delay };
