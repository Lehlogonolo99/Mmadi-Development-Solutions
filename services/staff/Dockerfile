# staff service container. Build from this folder:
#   docker build -t mmadi/staff-service services/staff
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm install --omit=dev --no-audit --no-fund; fi
COPY . .
USER node
EXPOSE 8080
CMD ["node", "server.js"]
