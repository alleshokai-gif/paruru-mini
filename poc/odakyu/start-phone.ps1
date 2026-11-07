param(
  [Parameter(Mandatory=$true)][string]$PhoneIp,
  [string]$ComputerIp,
  [int]$Port = 8768
)
$ErrorActionPreference = 'Stop'
if (-not $ComputerIp) {
  $candidates = @(& node -e "for(const i of Object.values(require('os').networkInterfaces()).flat()) if(i.family==='IPv4'&&!i.internal&&(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))) console.log(i.address)")
  if ($candidates.Count -ne 1) { throw 'PCのIPv4を -ComputerIp で指定してください。' }
  $ComputerIp = $candidates[0]
}
$previousHost = $env:ODAKYU_POC_HOST
$previousClient = $env:ODAKYU_POC_CLIENT
$previousPort = $env:ODAKYU_POC_PORT
try {
  $env:ODAKYU_POC_HOST = $ComputerIp
  $env:ODAKYU_POC_CLIENT = $PhoneIp
  $env:ODAKYU_POC_PORT = "$Port"
  & node (Join-Path $PSScriptRoot 'server.mjs')
  if ($LASTEXITCODE -ne 0) { throw '私用LANサーバーを起動できませんでした。IP・ポートと表示されたエラーを確認してください。' }
} finally {
  $env:ODAKYU_POC_HOST = $previousHost
  $env:ODAKYU_POC_CLIENT = $previousClient
  $env:ODAKYU_POC_PORT = $previousPort
}
