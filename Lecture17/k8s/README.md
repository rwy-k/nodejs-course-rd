# K8s (Minikube): Stage / Prod — різні namespace

## Найпростіший чесний варіант стеку

| Компонент      | Варіант у цьому проєкті |
|----------------|--------------------------|
| **Registry**   | GHCR (GitHub Container Registry) |
| **CI/CD**      | GitHub Actions |
| **Deploy target** | Self-hosted runner + Minikube |
| **Stage / Prod** | Різні namespace: `stage`, `production` |

Один кластер (Minikube), два namespace — ізоляція stage та production без окремих кластерів.

---

## Передумови

- Minikube: `minikube start`
- kubectl: налаштований на кластер (`kubectl config use-context minikube`)
- Образи в GHCR або збудовані локально (для локальної перевірки)

## Namespace

```bash
kubectl apply -f namespaces.yaml
```

Створюються namespace: `stage`, `production`.

## Deploy у namespace

**Stage** (образ з тегом stage-* або з release-manifest для develop):

```bash
export NAMESPACE=stage
export IMAGE_TAG=stage-abc1234   # або тег з вашого pipeline

# Підставити тег у manifests (або використати kustomize/helm)
kubectl apply -f configmap.yaml -n $NAMESPACE
kubectl apply -f services.yaml -n $NAMESPACE
# У deployments замість sha-PLACEHOLDER використати $IMAGE_TAG
kubectl set image deployment/orders-api orders-api=ghcr.io/<owner>/<repo>/orders-api:$IMAGE_TAG -n $NAMESPACE
kubectl set image deployment/payments payments=ghcr.io/<owner>/<repo>/payments:$IMAGE_TAG -n $NAMESPACE
kubectl set image deployment/worker worker=ghcr.io/<owner>/<repo>/orders-api:$IMAGE_TAG -n $NAMESPACE
```

**Production** (тег з release-manifest, immutable):

```bash
export NAMESPACE=production
# IMAGE_TAG з release-manifest.json (sha-*)
kubectl apply -f configmap.yaml -n $NAMESPACE
kubectl apply -f services.yaml -n $NAMESPACE
# образ з release-manifest, без rebuild
```

Postgres і RabbitMQ для stage/prod можна піднімати в тому ж namespace (StatefulSet/Deployment) або винести в окремий namespace/зовнішні сервіси.

## Self-hosted runner + Minikube

1. На машині з Minikube встановіть GitHub Actions runner (self-hosted).
2. У workflow deploy (stage/prod) вкажіть `runs-on: self-hosted` (або label вашого runner).
3. У job виконати `kubectl apply ... -n stage` або `-n production` з тегом з artifact/environment.

Таким чином **Registry: GHCR**, **CI/CD: GitHub Actions**, **Deploy target: self-hosted runner + Minikube**, **Stage/Prod: різні namespace**.
