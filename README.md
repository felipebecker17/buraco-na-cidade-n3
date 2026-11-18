# Buraco na Cidade: API containerizada e orquestrada

Atividade Avaliativa N3, DevOps & Cloud Computing (ADS, 4º semestre, UNIFASIPE, Prof. Marcelo Linck)
Aluno: **Felipe Becker** · Namespace Kubernetes: **`n3-felipe`**

API em **Node.js (Express)** do app *Buraco na Cidade*. O cidadão reporta buracos na rua e a prefeitura
acompanha o status (aberta → reconhecida → em execução → resolvida → confirmada).
Os dados ficam no **MySQL** e o **Redis** guarda o cache da listagem e um contador de visitas.
A API tem um painel web em `/` e o protótipo das telas do app em `/prototipo.html`.

```
            ┌──────────────── Docker Compose / Kubernetes ────────────────┐
 navegador  │  ┌───────────┐  SQL   ┌──────────┐                          │
 ─────────► │  │  api (2x) │ ─────► │  mysql   │──► volume / PVC (dados)  │
 :3000 /    │  │  Node.js  │        └──────────┘                          │
 :30080     │  │           │ cache  ┌──────────┐                          │
            │  └───────────┘ ─────► │  redis   │                          │
            └──────────────────────────────────────────────────────────────┘
```

## Estrutura

```
.
├── app/                     código da API, Dockerfile (multi-stage) e .dockerignore
│   ├── src/                 server.js, routes.js, db.js, cache.js, config.js
│   └── public/              painel (index.html) e protótipo das telas
├── docker-compose.yml       API + MySQL + Redis (volume, healthcheck, depends_on)
├── .env.example             modelo de variáveis (sem senhas reais)
├── k8s/                     manifestos da Parte 3  →  kubectl apply -f k8s/
├── k8s-bonus/               canary, HPA declarativo e gerador de carga (bônus/estudo)
├── scripts/                 patch do metrics-server e coleta de evidências
├── comandos.md              comandos da Parte 4 na ordem em que foram executados
└── README.md
```

## Variáveis de ambiente da API

| Variável | Para quê | Compose (origem) | Kubernetes (origem) |
|---|---|---|---|
| `PORT` | porta HTTP (3000) | compose | ConfigMap `api-config` |
| `DB_HOST` / `DB_PORT` | endereço do MySQL | `mysql` / 3306 | ConfigMap |
| `DB_NAME` / `DB_USER` | banco e usuário | `.env` | ConfigMap |
| `DB_PASSWORD` | senha do usuário | `.env` | Secret `mysql-secret` |
| `REDIS_HOST` / `REDIS_PORT` | endereço do Redis | `redis` / 6379 | ConfigMap |
| `CACHE_TTL_SECONDS` | tempo do cache | `.env` | ConfigMap |
| `APP_VERSION` | versão exibida | build-arg do Dockerfile | build-arg do Dockerfile |

## Rotas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | saúde completa (MySQL + Redis): 200 ou 503 |
| GET | `/health/live` | liveness: o processo está vivo |
| GET | `/health/ready` | readiness: pronto para tráfego (MySQL ok) |
| GET | `/api/info` | versão, nome do pod e contador de visitas (Redis) |
| GET | `/api/ocorrencias` | lista (com cache no Redis, header `X-Cache`) |
| GET | `/api/ocorrencias/:id` | detalhe |
| POST | `/api/ocorrencias` | cria `{endereco, bairro?, severidade?, descricao?}` |
| PATCH | `/api/ocorrencias/:id/status` | muda o status `{status}` |
| POST | `/api/ocorrencias/:id/apoiar` | +1 apoio |
| DELETE | `/api/ocorrencias/:id` | remove |
| GET | `/api/estatisticas` | totais por status |
| GET | `/api/carga` | gasta CPU de propósito (teste do HPA) |

---

## 1. Rodar com Docker Compose

Pré-requisito: Docker Desktop.

```powershell
copy .env.example .env          # Linux/macOS: cp .env.example .env
docker compose up -d --build
docker compose ps               # mysql e redis "healthy", depois a api
```

Acesse **http://localhost:3000** (painel) ou **http://localhost:3000/health**.

Prova de persistência:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/ocorrencias -ContentType "application/json" -Body '{"endereco":"Rua das Palmeiras, 245","severidade":"grave"}'
docker compose down
docker compose up -d
Invoke-RestMethod http://localhost:3000/api/ocorrencias     # o registro continua lá
```

Parar: `docker compose down`. Para apagar também os dados: `docker compose down -v`.

## 2. Rodar no Kubernetes (Docker Desktop)

Pré-requisitos: Docker Desktop com Kubernetes habilitado (contexto `docker-desktop`).

```powershell
docker build -t buraco-api:1.0 ./app       # a imagem fica disponível para o cluster local
kubectl apply -f k8s/
kubectl get all -n n3-felipe
kubectl get pods -n n3-felipe -w           # esperar todos READY (o MySQL leva ~30-60 s)
```

Acesse **http://localhost:30080** (Service NodePort).
Se o NodePort não abrir: `kubectl port-forward svc/api 8080:3000 -n n3-felipe` → http://localhost:8080

> **Killercoda / cluster sem acesso ao Docker local:** publique a imagem num registry
> (`docker tag buraco-api:1.0 SEU_USUARIO/buraco-api:1.0` e `docker push SEU_USUARIO/buraco-api:1.0`)
> e troque `image:` em `k8s/30-api-deployment.yaml` para `SEU_USUARIO/buraco-api:1.0`.

Ordem de aplicação: os arquivos são numerados (`00-namespace`, `01-configmap`, … `32-…`), então o
`kubectl apply -f k8s/` cria o namespace antes de tudo.

| Arquivo | Recurso |
|---|---|
| `00-namespace.yaml` | Namespace `n3-felipe` |
| `01-configmap.yaml` | ConfigMap `api-config` (config não sensível) |
| `02-secret.yaml` | Secret `mysql-secret` (senhas fictícias) |
| `10-mysql-pvc.yaml` | PVC de 1 GiB para o MySQL |
| `11-mysql-deployment.yaml` | MySQL 8.4: 1 réplica, `Recreate`, probes, requests/limits |
| `12-mysql-service.yaml` | Service ClusterIP `mysql` |
| `20-redis-deployment.yaml` / `21-redis-service.yaml` | Redis 7.4 + Service `redis` |
| `30-api-deployment.yaml` | API: 2 réplicas, readiness/liveness, requests/limits, rolling update sem queda |
| `31-api-service.yaml` | Service NodePort `api` (porta 30080) |
| `32-api-service-interno.yaml` | **Bônus:** Service ClusterIP `api-interno` (tráfego interno) |

A Parte 4 inteira (escala, rolling update, falha + `rollout undo`, `set resources`, HPA, nó) está em
**[comandos.md](comandos.md)**.

## 3. Bônus implementados

1. **Build multi-stage** (`app/Dockerfile`): estágio `deps` instala as dependências e o estágio `runtime` leva só o necessário, rodando como usuário `node`.
2. **Canary** (`k8s-bonus/api-canary.yaml`): 1 pod 2.0 junto de 2 pods 1.0 atrás do mesmo Service, recebendo cerca de 1/3 do tráfego.
3. **Segundo Service** (`k8s/32-api-service-interno.yaml`): ClusterIP para tráfego interno, separado do NodePort externo.

## 4. Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| `ErrImagePull` em `buraco-api:1.0` | imagem não construída no Docker local: `docker build -t buraco-api:1.0 ./app` |
| API `0/1 READY` | MySQL ainda iniciando; ver `kubectl logs deploy/api -n n3-felipe` (mostra as tentativas) |
| HPA com `<unknown>` | metrics-server ausente ou sem `--kubelet-insecure-tls` (ver comandos.md, item 0) |
| PVC `Pending` | cluster sem StorageClass padrão: `kubectl get storageclass` |
| Compose: `required variable ... is missing` | faltou criar o `.env` a partir do `.env.example` |

## 5. Segurança

- `.env` está no `.gitignore`; só o `.env.example` (com senhas de exemplo) é versionado.
- O Secret tem senhas **fictícias**. Em produção, usar um gerenciador de segredos (veja o relatório).
- A API roda como usuário não-root, com `readOnlyRootFilesystem` e sem escalada de privilégio.
