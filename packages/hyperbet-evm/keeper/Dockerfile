FROM oven/bun:1.3.8

WORKDIR /app

COPY workspace.package.json ./package.json
COPY workspace.bun.lock ./bun.lock
COPY workspace-packages/packages ./packages
COPY package.json ./packages/hyperbet-evm/keeper/package.json
COPY tsconfig.json ./packages/hyperbet-evm/keeper/tsconfig.json
COPY src ./packages/hyperbet-evm/keeper/src

RUN bun install --frozen-lockfile --production

WORKDIR /app/packages/hyperbet-evm/keeper

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "--bun", "src/service.ts"]
