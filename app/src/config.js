// Toda a configuração vem de VARIÁVEIS DE AMBIENTE.
// - No Docker Compose elas vêm do arquivo .env
// - No Kubernetes vêm do ConfigMap (não sensíveis) e do Secret (senha)
// Os valores depois do "||" são só padrões para desenvolvimento local.
const os = require('os');

const config = {
  port: Number(process.env.PORT || 3000),
  appVersion: process.env.APP_VERSION || 'dev',
  cidade: process.env.APP_CIDADE || 'Cuiabá, MT',
  hostname: os.hostname(), // no Kubernetes = nome do pod

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'buraco',
    user: process.env.DB_USER || 'buraco',
    password: process.env.DB_PASSWORD || '',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
  },

  cacheTtl: Number(process.env.CACHE_TTL_SECONDS || 30),
};

module.exports = config;
