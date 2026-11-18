// Ponto de entrada da API "Buraco na Cidade".
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const cache = require('./cache');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Log simples de cada requisição (exceto health checks, que são muitos)
app.use((req, res, next) => {
  if (!req.path.startsWith('/health')) {
    res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode}`));
  }
  next();
});

// ---------- Rotas de saúde ----------
// /health/live  -> LIVENESS: "o processo está vivo?" Não depende do banco.
//                  Se falhar, o Kubernetes REINICIA o container.
// /health/ready -> READINESS: "posso receber tráfego?" Depende do MySQL.
//                  Se falhar, o Kubernetes TIRA o pod do Service (sem reiniciar).
// /health       -> resumo completo (o mesmo critério do ready).
app.get('/health/live', (req, res) => {
  res.json({ status: 'vivo', pod: config.hostname, versao: config.appVersion });
});

async function saude(req, res) {
  const [mysqlOk, redisOk] = await Promise.all([db.ping(), cache.ping()]);
  res.status(mysqlOk ? 200 : 503).json({
    status: mysqlOk ? 'ok' : 'indisponivel',
    versao: config.appVersion,
    pod: config.hostname,
    mysql: mysqlOk ? 'ok' : 'falhou',
    redis: redisOk ? 'ok' : 'falhou (API segue sem cache)',
    uptime_s: Math.round(process.uptime()),
  });
}
app.get('/health', saude);
app.get('/health/ready', saude);

// ---------- API ----------
app.use('/api', routes);

// ---------- Front-end estático (painel + protótipo das telas) ----------
app.use(express.static(path.join(__dirname, '..', 'public')));

// 404 para rotas desconhecidas da API
app.use('/api', (req, res) => res.status(404).json({ erro: 'rota não encontrada' }));

// Tratamento central de erros
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[erro]', err.message);
  res.status(status).json({ erro: status === 500 ? 'erro interno' : err.message });
});

const server = app.listen(config.port, () => {
  console.log(`[api] Buraco na Cidade v${config.appVersion} ouvindo na porta ${config.port} (pod ${config.hostname})`);
});

// Conexões em segundo plano (a API sobe mesmo se o banco ainda não subiu)
cache.conectar();
db.conectarComRetry();

// Desligamento elegante: no rolling update o Kubernetes manda SIGTERM;
// paramos de aceitar conexões, terminamos as que estão em andamento e saímos.
function desligar(sinal) {
  console.log(`[api] ${sinal} recebido, encerrando...`);
  server.close(async () => {
    await Promise.allSettled([db.fechar(), cache.fechar()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT', () => desligar('SIGINT'));
