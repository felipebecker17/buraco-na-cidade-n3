# Coleta as evidências obrigatórias do relatório e salva cada saída em evidencias/
# Uso (na raiz do repositório):   powershell -ExecutionPolicy Bypass -File scripts/evidencias.ps1
# Opcional: informar outro namespace  ->  ... -File scripts/evidencias.ps1 -Namespace n3-fulano
param(
  [string]$Namespace = "n3-felipe",
  [string]$Node = ""
)

$ErrorActionPreference = "Continue"
$dir = Join-Path (Get-Location) "evidencias"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if (-not $Node) { $Node = (kubectl get nodes -o jsonpath='{.items[0].metadata.name}') }

$comandos = [ordered]@{
  "01-get-all"               = "kubectl get all -n $Namespace -o wide"
  "02-describe-deploy-api"   = "kubectl describe deployment api -n $Namespace"
  "03-rollout-history"       = "kubectl rollout history deployment/api -n $Namespace"
  "04-get-hpa"               = "kubectl get hpa -n $Namespace"
  "05-describe-hpa"          = "kubectl describe hpa api -n $Namespace"
  "06-top-pods"              = "kubectl top pods -n $Namespace"
  "07-describe-node"         = "kubectl describe node $Node"
  "08-describe-pods-api"     = "kubectl describe pod -n $Namespace -l app=api"
  "09-pvc-config-secret"     = "kubectl get pvc,configmap,secret -n $Namespace"
  "10-endpoints"             = "kubectl get endpoints -n $Namespace"
  "11-events"                = "kubectl get events -n $Namespace --sort-by=.lastTimestamp"
}

foreach ($nome in $comandos.Keys) {
  $cmd = $comandos[$nome]
  $arquivo = Join-Path $dir "$nome.txt"
  $cabecalho = "# $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  |  namespace: $Namespace`n# PS> $cmd`n"
  Write-Host "-> $cmd"
  $saida = Invoke-Expression "$cmd 2>&1" | Out-String
  ($cabecalho + $saida) | Out-File -FilePath $arquivo -Encoding utf8
}

Write-Host "`nPronto! Evidências salvas em: $dir"
