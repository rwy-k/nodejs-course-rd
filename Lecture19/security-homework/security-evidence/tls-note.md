# TLS — де шифрується, а де ні

- **Шифрування на вході:** Kubernetes Ingress (`k8s/ingress.yaml` — `tls`, `ssl-redirect`) або локальний nginx за прикладом `docker/nginx/local-gateway.tls.example.conf`.

- **Далі всередині:** до `orders-api` зазвичай йде **HTTP** по docker network / cluster IP — нормальний патерн «TLS на edge».

- **gRPC orders → payments:** зараз plain у compose; для реального prod хочеться TLS або mTLS.

- Розжованіше + mermaid — `docs/TRANSPORT-TLS.md`.
