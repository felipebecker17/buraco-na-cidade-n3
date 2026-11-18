# Registra o HPA e o número de réplicas a cada 15 s (antes, durante e depois da carga).
# Uso: powershell -ExecutionPolicy Bypass -File scripts/monitorar-hpa.ps1     (Ctrl+C para parar)
param([string]$Namespace = "n3-felipe", [int]$Intervalo = 15)

$arquivo = Join-Path (Get-Location) "evidencias/hpa-log.txt"
New-Item -ItemType Directory -Force -Path (Split-Path $arquivo) | Out-Null
"# Monitor do HPA - namespace $Namespace - inicio $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $arquivo -Encoding utf8

while ($true) {
  $hora = Get-Date -Format "HH:mm:ss"
  $hpa  = kubectl get hpa api -n $Namespace --no-headers 2>&1 | Out-String
  $linha = "$hora  $($hpa.Trim())"
  Write-Host $linha
  $linha | Out-File $arquivo -Append -Encoding utf8
  Start-Sleep -Seconds $Intervalo
}
