$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

foreach ($cmd in @("docker", "kind", "kubectl", "helm", "node")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd is not on PATH. Install Docker Desktop, kind, kubectl, and Helm, then run this script again."
  }
}

$cluster = "agentdock"
$existing = @(kind get clusters)
if ($existing -notcontains $cluster) {
  kind create cluster --config deploy/kind/cluster.yaml
}

kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s
kubectl -n local-path-storage rollout status deployment/local-path-provisioner --timeout=180s

$images = @(
  "woocommerce-mcp",
  "weather-mcp",
  "fx-mcp",
  "gateway",
  "dashboard"
)
foreach ($image in $images) {
  docker build -t "agentdock/${image}:local" "apps/$image"
  kind load docker-image "agentdock/${image}:local" --name $cluster
}

node deploy/scripts/generate-secrets.mjs
helm upgrade --install agentdock deploy/helm/urumi `
  --namespace agentdock --create-namespace `
  --timeout 20m `
  -f deploy/helm/urumi/values-local.yaml `
  -f deploy/helm/urumi/secrets.local.yaml

kubectl -n shop rollout status deployment/wordpress --timeout=300s
kubectl -n shop wait --for=condition=complete job/wc-bootstrap --timeout=900s
kubectl -n platform rollout status deployment/gateway --timeout=180s
kubectl -n platform rollout status deployment/dashboard --timeout=180s

Write-Host "Storefront: http://shop.localtest.me"
Write-Host "Dashboard:  http://app.localtest.me"
Write-Host "MCP:        http://app.localtest.me/mcp"
