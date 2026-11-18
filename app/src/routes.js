// Rotas da API REST de ocorrências (buracos reportados).
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const cache = require('./cache');
const config = require('./config');

const router = express.Router();

const SEVERIDADES = ['leve', 'moderado', 'grave'];
const STATUS = ['aberta', 'reconhecida', 'em_execucao', 'resolvida', 'confirmada'];
const CHAVE_LISTA = 'ocorrencias:lista';
const CHAVE_STATS = 'ocorrencias:estatisticas';

// Envolve handlers async para que erros caiam no middleware de erro.
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function idValido(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('id inválido');
    err.status = 400;
    throw err;
  }
  return id;
}

async function invalidarCache() {
  await cache.del(CHAVE_LISTA, CHAVE_STATS);
}

// Informações do pod/versão — útil para ver o balanceamento entre réplicas
// e para enxergar a troca de versão no rolling update.
router.get('/info', h(async (req, res) => {
  const visitas = await cache.incr('visitas');
  res.json({
    app: 'Buraco na Cidade API',
    versao: config.appVersion,
    pod: config.hostname,
    cidade: config.cidade,
    visitas, // contador global guardado no Redis (compartilhado entre réplicas)
  });
}));

// Lista ocorrências (com cache no Redis por CACHE_TTL_SECONDS)
router.get('/ocorrencias', h(async (req, res) => {
  const emCache = await cache.get(CHAVE_LISTA);
  if (emCache) {
    res.set('X-Cache', 'HIT');
    return res.json(emCache);
  }
  const [linhas] = await db.getPool().query(
    'SELECT * FROM ocorrencias ORDER BY criado_em DESC, id DESC LIMIT 200'
  );
  await cache.set(CHAVE_LISTA, linhas, config.cacheTtl);
  res.set('X-Cache', 'MISS');
  res.json(linhas);
}));

router.get('/ocorrencias/:id', h(async (req, res) => {
  const id = idValido(req);
  const [linhas] = await db.getPool().query('SELECT * FROM ocorrencias WHERE id = ?', [id]);
  if (!linhas.length) return res.status(404).json({ erro: 'ocorrência não encontrada' });
  res.json(linhas[0]);
}));

// Cria uma ocorrência: { endereco, bairro?, severidade?, descricao? }
router.post('/ocorrencias', h(async (req, res) => {
  const { endereco, bairro = null, severidade = 'moderado', descricao = null } = req.body || {};
  if (!endereco || typeof endereco !== 'string' || !endereco.trim()) {
    return res.status(400).json({ erro: 'campo "endereco" é obrigatório' });
  }
  if (!SEVERIDADES.includes(severidade)) {
    return res.status(400).json({ erro: `severidade deve ser: ${SEVERIDADES.join(', ')}` });
  }
  const [r] = await db.getPool().query(
    'INSERT INTO ocorrencias (endereco, bairro, severidade, descricao) VALUES (?, ?, ?, ?)',
    [endereco.trim().slice(0, 200), bairro, severidade, descricao]
  );
  await invalidarCache();
  const [linhas] = await db.getPool().query('SELECT * FROM ocorrencias WHERE id = ?', [r.insertId]);
  res.status(201).json(linhas[0]);
}));

// Atualiza o status (fluxo da prefeitura): { status }
router.patch('/ocorrencias/:id/status', h(async (req, res) => {
  const id = idValido(req);
  const { status } = req.body || {};
  if (!STATUS.includes(status)) {
    return res.status(400).json({ erro: `status deve ser: ${STATUS.join(', ')}` });
  }
  const [r] = await db.getPool().query('UPDATE ocorrencias SET status = ? WHERE id = ?', [status, id]);
  if (!r.affectedRows) return res.status(404).json({ erro: 'ocorrência não encontrada' });
  await invalidarCache();
  res.json({ id, status });
}));

// Cidadão apoia (+1) uma ocorrência
router.post('/ocorrencias/:id/apoiar', h(async (req, res) => {
  const id = idValido(req);
  const [r] = await db.getPool().query('UPDATE ocorrencias SET apoios = apoios + 1 WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ erro: 'ocorrência não encontrada' });
  await invalidarCache();
  const [linhas] = await db.getPool().query('SELECT id, apoios FROM ocorrencias WHERE id = ?', [id]);
  res.json(linhas[0]);
}));

router.delete('/ocorrencias/:id', h(async (req, res) => {
  const id = idValido(req);
  const [r] = await db.getPool().query('DELETE FROM ocorrencias WHERE id = ?', [id]);
  if (!r.affectedRows) return res.status(404).json({ erro: 'ocorrência não encontrada' });
  await invalidarCache();
  res.status(204).end();
}));

// Números agregados para o painel (também cacheados)
router.get('/estatisticas', h(async (req, res) => {
  const emCache = await cache.get(CHAVE_STATS);
  if (emCache) {
    res.set('X-Cache', 'HIT');
    return res.json(emCache);
  }
  const [porStatus] = await db.getPool().query(
    'SELECT status, COUNT(*) AS total FROM ocorrencias GROUP BY status'
  );
  const [[{ total }]] = await db.getPool().query('SELECT COUNT(*) AS total FROM ocorrencias');
  const dados = { total: Number(total), porStatus };
  await cache.set(CHAVE_STATS, dados, config.cacheTtl);
  res.set('X-Cache', 'MISS');
  res.json(dados);
}));

// Rota que gasta CPU de propósito (~15-60 ms por chamada, conforme o limite de CPU).
// Usada pelo gerador de carga (busybox) para fazer o HPA escalar.
router.get('/carga', (req, res) => {
  const inicio = process.hrtime.bigint();
  crypto.pbkdf2Sync('buraco-na-cidade', 'sal', 100000, 32, 'sha256');
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  res.json({ pod: config.hostname, versao: config.appVersion, cpu_ms: Math.round(ms) });
});

module.exports = router;
