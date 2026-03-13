FROM oven/bun:1.3.8

WORKDIR /app

COPY keeper/package.json ./keeper/package.json
COPY keeper/bun.lock ./keeper/bun.lock
RUN cd keeper && bun install --frozen-lockfile --production

COPY deployments ./deployments
COPY keeper/tsconfig.json ./keeper/tsconfig.json
COPY keeper/src ./keeper/src

WORKDIR /app/keeper

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "--bun", "src/service.ts"]
