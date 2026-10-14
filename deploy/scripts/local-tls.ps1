# Trust a local certificate for *.localtest.me and install it where ingress-nginx can serve it.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Dir = Join-Path $Root "deploy\helm\urumi\.local-tls"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$crtPath = Join-Path $Dir "tls.crt"
$keyPath = Join-Path $Dir "tls.key"

if (-not (Test-Path $crtPath) -or -not (Test-Path $keyPath)) {
  $existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.FriendlyName -eq "AgentDock localtest.me" } | Select-Object -First 1
  if ($existing) { $cert = $existing }
  else {
    $cert = New-SelfSignedCertificate `
      -Subject "CN=localtest.me" `
      -DnsName "localtest.me", "*.localtest.me" `
      -CertStoreLocation "Cert:\CurrentUser\My" `
      -FriendlyName "AgentDock localtest.me" `
      -NotAfter (Get-Date).AddYears(2) `
      -KeyExportPolicy Exportable `
      -KeyAlgorithm RSA `
      -KeyLength 2048 `
      -HashAlgorithm SHA256 `
      -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1")
  }
  $pfx = Join-Path $Dir "tls.pfx"
  $secure = ConvertTo-SecureString "agentdock" -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $secure | Out-Null
  docker run --rm -v "${Dir}:/certs" alpine:3.20 sh -c "apk add --no-cache openssl >/dev/null && openssl pkcs12 -in /certs/tls.pfx -clcerts -nokeys -out /certs/tls.crt -passin pass:agentdock && openssl pkcs12 -in /certs/tls.pfx -nocerts -nodes -out /certs/tls.key -passin pass:agentdock"
  if ($LASTEXITCODE -ne 0) { throw "Could not convert the certificate to PEM" }
  Remove-Item $pfx -Force
  $cer = Join-Path $Dir "tls.cer"
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  certutil -user -addstore Root $cer | Out-Null
}

$namespaces = @("ingress-nginx", "shop", "platform")
foreach ($ns in $namespaces) {
  kubectl get namespace $ns | Out-Null
  kubectl -n $ns create secret tls localtest-tls --cert="$crtPath" --key="$keyPath" --dry-run=client -o yaml | kubectl apply -f -
}

$cmPatch = Join-Path $env:TEMP "agentdock-nginx-cm.json"
[System.IO.File]::WriteAllText($cmPatch, '{"data":{"ssl-redirect":"true","force-ssl-redirect":"true"}}')
kubectl -n ingress-nginx patch configmap ingress-nginx-controller --type merge --patch-file $cmPatch
if ($LASTEXITCODE -ne 0) { throw "Could not enable the HTTPS redirect" }
$currentArgs = kubectl -n ingress-nginx get deploy ingress-nginx-controller -o jsonpath="{.spec.template.spec.containers[0].args}"
if ($currentArgs -notmatch "default-ssl-certificate") {
  $argPatch = Join-Path $env:TEMP "agentdock-nginx-args.json"
  [System.IO.File]::WriteAllText($argPatch, '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--default-ssl-certificate=ingress-nginx/localtest-tls"}]')
  kubectl -n ingress-nginx patch deploy ingress-nginx-controller --type json --patch-file $argPatch
  if ($LASTEXITCODE -ne 0) { throw "Could not set the default certificate" }
}
kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller --timeout=180s
Write-Host "Local HTTPS certificate is installed for *.localtest.me"
