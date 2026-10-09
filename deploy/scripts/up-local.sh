#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

for cmd in docker kind kubectl helm node; do
  command -v "$cmd" >/dev/null || { echo "$cmd is not on PATH"; exit 1; }
done

if ! kind get clusters | grep -qx agentdock; then
  kind create cluster --config deploy/kind/cluster.yaml
fi

kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s
kubectl -n local-path-storage rollout status deployment/local-path-provisioner --timeout=180s

for image in woocommerce-mcp weather-mcp fx-mcp gateway dashboard; do
  docker build -t "agentdock/${image}:local" "apps/${image}"
  kind load docker-image "agentdock/${image}:local" --name agentdock
done

node deploy/scripts/generate-secrets.mjs
helm upgrade --install agentdock deploy/helm/urumi \
  --namespace agentdock --create-namespace \
  --timeout 20m \
  -f deploy/helm/urumi/values-local.yaml \
  -f deploy/helm/urumi/secrets.local.yaml

kubectl -n shop rollout status deployment/wordpress --timeout=300s
kubectl -n shop wait --for=condition=complete job/wc-bootstrap --timeout=900s
kubectl -n platform rollout status deployment/gateway --timeout=180s
kubectl -n platform rollout status deployment/dashboard --timeout=180s

echo "Storefront: http://shop.localtest.me"
echo "Dashboard:  http://app.localtest.me"
echo "MCP:        http://app.localtest.me/mcp"
