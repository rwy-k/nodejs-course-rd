FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci

FROM node:20-alpine AS dev

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY package.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

EXPOSE 3000

CMD ["npm", "run", "start:dev"]

FROM node:20-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY package.json ./
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

RUN npm prune --production

FROM node:20-alpine AS migrations

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

USER node

CMD ["npm", "run", "migration:run:prod"]

FROM node:20-alpine AS prod

WORKDIR /app

RUN mkdir -p /app && chown -R node:node /app

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

CMD ["node", "dist/main"]

FROM gcr.io/distroless/nodejs20-debian12 AS prod-distroless

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

USER nonroot

EXPOSE 3000

CMD ["dist/main"]
