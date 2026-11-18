// Redis é usado como CACHE e CONTADOR. Se o Redis cair, a API continua
// funcionando (só fica sem cache): todas as funções abaixo engolem o erro.
const { createClient } = require('redis');
const config = require('./config');

const client = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    // reconecta sozinho, esperando no máximo 5s entre tentativas
    reconnectStrategy: (tentativas) => Math.min(tentativas * 500, 5000),
  },
});

let avisou = false;
client.on('ready', () => {
  avisou = false;
  console.log(`[redis] conectado em ${config.redis.host}:${config.redis.port}`);
});
client.on('error', (err) => {
  if (!avisou) console.warn(`[redis] indisponível (${err.code || err.message}); seguindo sem cache`);
  avisou = true;
});

async function conectar() {
  try {
    await client.connect();
  } catch {
    /* o reconnectStrategy continua tentando em segundo plano */
  }
}

const disponivel = () => client.isReady;

async function ping() {
  if (!disponivel()) return false;
  try {
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}

async function get(chave) {
  if (!disponivel()) return null;
  try {
    const v = await client.get(chave);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

async function set(chave, valor, ttlSegundos) {
  if (!disponivel()) return;
  try {
    await client.set(chave, JSON.stringify(valor), { EX: ttlSegundos });
  } catch {
    /* sem cache */
  }
}

async function del(...chaves) {
  if (!disponivel()) return;
  try {
    await client.del(chaves);
  } catch {
    /* sem cache */
  }
}

async function incr(chave) {
  if (!disponivel()) return null;
  try {
    return await client.incr(chave);
  } catch {
    return null;
  }
}

async function fechar() {
  try {
    if (client.isOpen) await client.quit();
  } catch {
    /* ignorar */
  }
}

module.exports = { conectar, disponivel, ping, get, set, del, incr, fechar };
