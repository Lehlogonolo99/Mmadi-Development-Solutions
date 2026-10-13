# Static website + staff portal. Build from the repository root:
#   docker build -f deploy/web/Dockerfile -t mmadi/web .
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
# /__/firebase/init.json (the portal's Firebase web config) is mounted at runtime,
# from a ConfigMap in Kubernetes or a file in docker-compose.
EXPOSE 8080
