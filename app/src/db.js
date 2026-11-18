// Conexão com o MySQL usando um pool (várias conexões reaproveitadas).
// A API NÃO morre se o banco ainda não estiver pronto: ela fica tentando
// conectar em segundo plano. Enquanto isso, /health/ready responde 503 e o
// Kubernetes não manda tráfego para este pod (readinessProbe).
const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;
let pronto = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ocorrencias (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  endereco      VARCHAR(200) NOT NULL,
  bairro        VARCHAR(100) NULL,
  severidade    ENUM('leve','moderado','grave') NOT NULL DEFAULT 'moderado',
  status        ENUM('aberta','reconhecida','em_execucao','resolvida','confirmada') NOT NULL DEFAULT 'aberta',
  descricao     TEXT NULL,
  apoios        INT NOT NULL DEFAULT 0,
  criado_em     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function conectarComRetry() {
  for (let tentativa = 1; ; tentativa++) {
    try {
      if (!pool) {
        pool = mysql.createPool({
          ...config.db,
          waitForConnections: true,
          connectionLimit: 5,
          enableKeepAlive: true,
        });
      }
      await pool.query('SELECT 1');
      await pool.query(SCHEMA); // cria a tabela na primeira vez
      pronto = true;
      console.log(`[db] conectado em ${config.db.host}:${config.db.port}/${config.db.database}`);
      return;
    } catch (err) {
      pronto = false;
      const espera = Math.min(2000 * tentativa, 10000);
      console.warn(`[db] tentativa ${tentativa} falhou (${err.code || err.message}); nova tentativa em ${espera / 1000}s`);
      await esperar(espera);
    }
  }
}

async function ping() {
  if (!pool || !pronto) return false;
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

function getPool() {
  if (!pool || !pronto) {
    const err = new Error('Banco de dados indisponível');
    err.status = 503;
    throw err;
  }
  return pool;
}

async function fechar() {
  if (pool) await pool.end();
}

module.exports = { conectarComRetry, ping, getPool, fechar };
