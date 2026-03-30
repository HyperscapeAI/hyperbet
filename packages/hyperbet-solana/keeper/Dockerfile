FROM oven/bun:1.3.8

WORKDIR /app

COPY workspace.package.json ./package.json
COPY workspace.bun.lock ./bun.lock
COPY workspace-packages/packages ./packages
COPY package.json ./packages/hyperbet-solana/keeper/package.json
COPY tsconfig.json ./packages/hyperbet-solana/keeper/tsconfig.json
COPY src ./packages/hyperbet-solana/keeper/src
COPY start.sh ./packages/hyperbet-solana/keeper/start.sh

RUN chmod +x ./packages/hyperbet-solana/keeper/start.sh
RUN bun install --frozen-lockfile --production

WORKDIR /app/packages/hyperbet-solana/keeper

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bash", "start.sh"]
