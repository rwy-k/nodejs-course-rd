FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/payments-service/package.json apps/payments-service/package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY packages/contracts /packages/contracts
COPY apps/payments-service/package.json apps/payments-service/package-lock.json* ./
COPY apps/payments-service/nest-cli.json apps/payments-service/tsconfig.json ./
COPY apps/payments-service/src ./src
RUN npm run build && npm prune --production

FROM node:20-alpine AS prod
WORKDIR /app
RUN mkdir -p /app && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /packages/contracts /packages/contracts
USER node
EXPOSE 5001 3001
CMD ["node", "dist/main"]
