const axios = require('axios');

async function enviarMensagem(telefone, texto) {
  try {
    const url = `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
    await axios.post(url,
      { number: telefone, text: texto },
      { headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('❌ Erro Evolution:', e.message);
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarComDelay(telefone, mensagens) {
  for (let i = 0; i < mensagens.length; i++) {
    await enviarMensagem(telefone, mensagens[i]);
    if (i < mensagens.length - 1) await delay(1500);
  }
}

module.exports = { enviarMensagem, enviarComDelay, delay };
