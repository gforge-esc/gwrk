FROM docker.io/library/docker:29.10.0-dind@sha256:4bbc7223f81db790097c6dea42fb93e05b8fead4f0431fbe6ccaba6e8473201c AS docker-cli
FROM node:22.23.4-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f AS dependencies
WORKDIR /app
ENV CI=true
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS application
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
FROM dependencies AS production-dependencies
RUN pnpm prune --prod
FROM node:22.23.4-bookworm@sha256:7702d8aa4d5910871692af4480eb3ba86f23047a6417a44d857d06c95d060d3f
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=application /app/dist ./dist
COPY --from=application /app/package.json ./package.json
COPY --from=docker-cli /usr/local/bin/docker /usr/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
CMD ["node", "dist/cli.js", "--help"]
