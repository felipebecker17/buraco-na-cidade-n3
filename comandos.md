# comandos.md — registro dos comandos (na ordem de execução)

Aluno: **Felipe Becker** · Namespace: **`n3-felipe`** · Ambiente: Docker Desktop + Kubernetes (kubeadm), PowerShell no Windows.

> Todos os comandos estão em **uma linha só** (PowerShell não usa `\` para quebrar linha).
> Rodar sempre a partir da **raiz do repositório**.
> Em PowerShell use `curl.exe` (o `curl` puro é um alias do `Invoke-WebRequest`).

---

## Parte 1 — Docker (imagem da API)

```powershell
docker build -t buraco-api:1.0 ./app
docker images buraco-api
docker run -d --name api-teste -p 3001:3000 buraco-api:1.0
curl.exe http://localhost:3001/health/live
curl.exe http://localhost:3001/health
docker logs api-teste
docker rm -f api-teste
```

O que observar:
- `/health/live` responde 200 (o processo está vivo).
- `/health` responde **503** com `"mysql":"falhou"`: o container está sozinho, sem banco. É o esperado. A API não cai, fica tentando reconectar (veja em `docker logs`).
- `docker images` mostra o tamanho da imagem. Ela é pequena por causa do Alpine e do build multi-stage.

---

## Parte 2 — Docker Compose

```powershell
copy .env.example .env
docker compose up -d --build
docker compose ps
curl.exe http://localhost:3000/health
```

Criar um dado (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/ocorrencias -ContentType "application/json" -Body '{"endereco":"Rua das Palmeiras, 245","bairro":"Jardim","severidade":"grave"}'
Invoke-RestMethod http://localhost:3000/api/ocorrencias
```

Prova de que o dado **sobrevive** a `down` + `up`:

```powershell
docker compose down
docker volume ls
docker compose up -d
docker compose ps
Invoke-RestMethod http://localhost:3000/api/ocorrencias
docker compose exec mysql mysql -uburaco -psenha-exemplo-app buraco -e "SELECT id, endereco, status FROM ocorrencias"
```

O que observar:
- `docker compose ps` mostra `mysql` e `redis` como **healthy** antes de a API subir (efeito do `depends_on: condition: service_healthy`).
- Depois do `down` o volume `buraco-na-cidade_mysql-data` continua em `docker volume ls`, e a ocorrência continua lá depois do `up`.
- (`docker compose down -v` apagaria o volume. **Não** use na prova.)

```powershell
docker compose down
```

---

## Parte 3 — Kubernetes com arquivos YAML

```powershell
kubectl config current-context
kubectl apply -f k8s/
kubectl get all -n n3-felipe
kubectl get pvc,configmap,secret -n n3-felipe
kubectl get pods -n n3-felipe -o wide --show-labels
kubectl get endpoints -n n3-felipe
curl.exe http://localhost:30080/health
```

> O contexto deve ser `docker-desktop`. A imagem `buraco-api:1.0` já existe no Docker local
> (Parte 1), e como o Deployment usa `imagePullPolicy: IfNotPresent` o cluster usa essa imagem
> sem precisar de registry.
> Alternativa de acesso se o NodePort não abrir:
> `kubectl port-forward svc/api 8080:3000 -n n3-felipe` e depois http://localhost:8080

Criar dado pelo Kubernetes:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:30080/api/ocorrencias -ContentType "application/json" -Body '{"endereco":"Av. Getulio Vargas, 12","bairro":"Centro","severidade":"moderado"}'
Invoke-RestMethod http://localhost:30080/api/ocorrencias
```

**Prova de persistência:** apagar o pod do MySQL e mostrar que os dados continuam.

```powershell
kubectl get pods -n n3-felipe -l app=mysql
kubectl delete pod -n n3-felipe -l app=mysql
kubectl get pods -n n3-felipe -l app=mysql -w
kubectl exec -n n3-felipe deploy/mysql -- mysql -uburaco -psenha-exemplo-app buraco -e "SELECT id, endereco, status FROM ocorrencias"
Invoke-RestMethod http://localhost:30080/api/ocorrencias/1
```

O que observar: o pod novo tem **outro nome** (o Deployment recriou), mas o `SELECT` mostra as
mesmas linhas, porque os dados estão no **PVC** e não dentro do container.
(`Ctrl+C` para sair do `-w`.)

---

## Parte 4 — Operação do cluster por comandos

### 0. Pré-requisito: metrics-server (necessário para `kubectl top` e para o HPA)

```powershell
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file scripts/metrics-server-patch.json
kubectl -n kube-system rollout status deployment metrics-server
kubectl -n kube-system get pods -l k8s-app=metrics-server
kubectl top nodes
```

> O patch (arquivo `scripts/metrics-server-patch.json`) liga `--kubelet-insecure-tls`. Ele é necessário
> no Docker Desktop porque o certificado do kubelet é autoassinado. O `--patch-file` evita o problema
> de aspas do JSON no PowerShell. Se já existia um metrics-server com defeito, antes rode
> `kubectl delete -f <mesma URL>` e depois o `apply`.

### 1. Escalar na mão (2 → 4 → 2)

```powershell
kubectl get deployment api -n n3-felipe
kubectl scale deployment api --replicas=4 -n n3-felipe
kubectl get pods -n n3-felipe -l app=api -o wide
kubectl scale deployment api --replicas=2 -n n3-felipe
kubectl get pods -n n3-felipe -l app=api
```

Ver o balanceamento entre réplicas (o campo `pod` muda):

```powershell
1..6 | ForEach-Object { (Invoke-RestMethod http://localhost:30080/api/info).pod }
```

### 2. Atualizar sem derrubar (versão 2.0)

Mudança visível da 2.0: o painel (http://localhost:30080) mostra um **banner azul "Nova versão 2.0"** e o selo `v2.0`.

```powershell
docker build --build-arg APP_VERSION=2.0 -t buraco-api:2.0 ./app
```

Em **outro terminal**, deixar rodando para provar que não há queda:

```powershell
while ($true) { try { $r = Invoke-RestMethod http://localhost:30080/api/info; "$(Get-Date -Format HH:mm:ss) v$($r.versao) $($r.pod)" } catch { "$(Get-Date -Format HH:mm:ss) FALHOU" }; Start-Sleep -Milliseconds 500 }
```

No terminal principal:

```powershell
kubectl set image deployment/api api=buraco-api:2.0 -n n3-felipe
kubectl annotate deployment/api kubernetes.io/change-cause="atualiza para 2.0 (banner visivel)" --overwrite -n n3-felipe
kubectl rollout status deployment/api -n n3-felipe
kubectl rollout history deployment/api -n n3-felipe
kubectl get rs -n n3-felipe -l app=api
curl.exe http://localhost:30080/api/info
```

O que observar: no outro terminal as respostas passam de `v1.0` para `v2.0` **sem nenhuma linha "FALHOU"**
(`maxUnavailable: 0` + readinessProbe). O `get rs` mostra o ReplicaSet antigo com 0 réplicas e o novo com 2.

### 3. Falha proposital e recuperação

```powershell
kubectl set image deployment/api api=buraco-api:9.9-nao-existe -n n3-felipe
kubectl annotate deployment/api kubernetes.io/change-cause="falha proposital: imagem 9.9 inexistente" --overwrite -n n3-felipe
kubectl rollout status deployment/api -n n3-felipe --timeout=60s
kubectl get pods -n n3-felipe -l app=api
kubectl describe pod -n n3-felipe -l app=api
kubectl get events -n n3-felipe --sort-by=.lastTimestamp
```

Diagnóstico esperado:
- `get pods`: um pod novo em `ErrImagePull` / `ImagePullBackOff`, e os **2 pods antigos (2.0) continuam Running** e atendendo.
- `describe pod` (seção **Events**): `Failed to pull image "buraco-api:9.9-nao-existe" ... pull access denied / repository does not exist`, depois `Back-off pulling image`.
- O `rollout status` estoura o timeout porque o pod novo nunca fica pronto.

Recuperação:

```powershell
kubectl rollout undo deployment/api -n n3-felipe
kubectl rollout status deployment/api -n n3-felipe
kubectl get pods -n n3-felipe -l app=api
kubectl rollout history deployment/api -n n3-felipe
```

### 4. Limitar recursos (`kubectl set resources`)

Valores do YAML: requests 50m/64Mi e limits 250m/128Mi. Depois de olhar o `kubectl top pods`, ajustei para:

```powershell
kubectl top pods -n n3-felipe
kubectl set resources deployment api -n n3-felipe --containers=api --requests=cpu=100m,memory=96Mi --limits=cpu=300m,memory=192Mi
kubectl annotate deployment/api kubernetes.io/change-cause="ajuste de requests/limits (100m/96Mi - 300m/192Mi)" --overwrite -n n3-felipe
kubectl rollout status deployment/api -n n3-felipe
kubectl describe pod -n n3-felipe -l app=api
```

No `describe pod` conferir em cada pod: `Limits: cpu 300m, memory 192Mi` e `Requests: cpu 100m, memory 96Mi`,
além de `QoS Class: Burstable`.

> Atenção à unidade: `cpu=100` sem o `m` significa **100 núcleos** (o pod nunca seria agendado);
> o certo é `cpu=100m` (0,1 núcleo).

### 5. Autoscaling (HPA)

```powershell
kubectl autoscale deployment api --cpu-percent=50 --min=2 --max=6 -n n3-felipe
kubectl get hpa -n n3-felipe
```

> Em versões novas do kubectl o `--cpu-percent` aparece como obsoleto. O equivalente é `--cpu=50%`.
> Espere a coluna TARGETS sair de `<unknown>` para algo como `cpu: 2%/50%` (cerca de 30 a 60 s).

**Terminal 2** (deixar aberto durante todo o teste: é a evidência *antes, durante e depois*):

```powershell
kubectl get hpa api -n n3-felipe -w
```

**Terminal 1:** gerar carga **dentro do cluster** (busybox chamando o Service interno):

```powershell
kubectl create deployment carga --image=busybox:1.36 --replicas=2 -n n3-felipe -- sh -c "while true; do wget -q -O- http://api-interno/api/carga > /dev/null; done"
kubectl get pods -n n3-felipe -l app=carga
kubectl top pods -n n3-felipe
kubectl get deployment api -n n3-felipe
kubectl describe hpa api -n n3-felipe
```

Depois de 1 a 3 minutos, as réplicas sobem (até 6). Para acabar com a carga:

```powershell
kubectl delete deployment carga -n n3-felipe
kubectl top pods -n n3-felipe
```

As réplicas **descem de volta para 2** depois de cerca de **5 minutos**. Essa é a janela de estabilização
de scale-down do HPA, que evita ficar subindo e descendo à toa. Conferir com `kubectl get hpa api -n n3-felipe`
e `kubectl describe hpa api -n n3-felipe` (seção Events: `New size: 6; reason: cpu resource utilization above target`
e depois `New size: 2; reason: All metrics below target`).

> Opcional: `scripts/monitorar-hpa.ps1` grava um registro com horário a cada 15 s em `evidencias/hpa-log.txt`.

### 6. Nó

```powershell
kubectl get nodes -o wide
kubectl describe node docker-desktop
kubectl top nodes
```

Seções a explicar no relatório: **Capacity** (recursos físicos totais do nó), **Allocatable** (o que sobra para
pods depois das reservas do sistema/kubelet) e **Allocated resources** (soma dos *requests*/*limits* dos pods
agendados no nó, em valor absoluto e em % do Allocatable).

---

## Evidências obrigatórias (para o relatório)

```powershell
kubectl get all -n n3-felipe
kubectl describe deployment api -n n3-felipe
kubectl rollout history deployment/api -n n3-felipe
kubectl get hpa api -n n3-felipe -w
kubectl top pods -n n3-felipe
kubectl describe node docker-desktop
```

> `scripts/evidencias.ps1` executa todos esses comandos (menos o `-w`) e salva cada saída em `evidencias/`.

---

## Bônus

### Canary (2.0 recebendo ~1/3 do tráfego)

Partindo da API estável na 1.0 (`kubectl rollout undo` até voltar para a 1.0, ou `kubectl set image deployment/api api=buraco-api:1.0 -n n3-felipe`):

```powershell
kubectl apply -f k8s-bonus/api-canary.yaml
kubectl get pods -n n3-felipe -l app=api -L track
kubectl get endpoints api -n n3-felipe
1..30 | ForEach-Object { (Invoke-RestMethod http://localhost:30080/api/info).versao } | Group-Object | Select-Object Name, Count
```

Resultado esperado: cerca de 20 respostas `1.0` e 10 respostas `2.0`. Para **promover**:
`kubectl set image deployment/api api=buraco-api:2.0 -n n3-felipe` e depois `kubectl delete -f k8s-bonus/api-canary.yaml`.
Para **abortar**, só o `delete`.

### Segundo Service

`k8s/32-api-service-interno.yaml` (ClusterIP `api-interno`) é usado pelo gerador de carga; o NodePort `api` é o acesso externo.

---

## Limpeza

```powershell
kubectl delete hpa api -n n3-felipe
kubectl delete namespace n3-felipe
docker compose down
```
