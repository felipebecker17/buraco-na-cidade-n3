# syntax=docker/dockerfile:1
# =====================================================================
# Dockerfile MULTI-STAGE da API "Buraco na Cidade"
#   Estágio 1 (deps):    instala só as dependências de produção
#   Estágio 2 (runtime): imagem final enxuta, só com o necessário
# Build:  docker build -t buraco-api:1.0 ./app
#         docker build --build-arg APP_VERSION=2.0 -t buraco-api:2.0 ./app
# =====================================================================

# ---------- Estágio 1: dependências ----------
# Imagem base enxuta (Alpine Linux, ~50 MB) com Node.js 22 LTS
FROM node:22-alpine AS deps
WORKDIR /app
# Copia SÓ os manifestos de dependência primeiro: enquanto o package.json
# não mudar, o Docker reaproveita o cache desta camada e não reinstala tudo.
COPY package*.json ./
# npm ci (se houver package-lock.json) é reprodutível; --omit=dev ignora devDependencies
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

# ---------- Estágio 2: runtime ----------
FROM node:22-alpine AS runtime
# Versão exibida pela API (muda na 2.0 sem mexer no código)
ARG APP_VERSION=1.0
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000
WORKDIR /app
# Traz do estágio 1 apenas a pasta node_modules pronta (sem cache do npm)
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Copia o código da aplicação (o .dockerignore filtra o que não deve entrar)
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
# Segurança: não roda como root. O usuário "node" já existe na imagem oficial.
USER node
# Documenta a porta em que a API escuta
EXPOSE 3000
# Healthcheck do próprio Docker (o Kubernetes usa as probes do Deployment)
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live >/dev/null || exit 1
# Forma "exec" (array): o node vira o PID 1 e recebe o SIGTERM direto
CMD ["node", "src/server.js"]
