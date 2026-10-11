FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apk add --no-cache libc6-compat ffmpeg openssl
RUN npm install -g tsx turbo

FROM base AS builder
WORKDIR /app
COPY . .
RUN turbo prune @workspace/social-studio-backend --docker

FROM base AS installer
WORKDIR /app
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/packages/db-social-studio/prisma ./packages/db-social-studio/prisma
RUN pnpm install --prefer-frozen-lockfile
COPY --from=builder /app/out/full/ .
RUN pnpm --filter @workspace/db-social-studio build || true
RUN pnpm turbo run build --filter=@workspace/social-studio-backend...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=installer /app .

WORKDIR /app/apps/180-social-studio-backend

EXPOSE 4005
ENV PORT=4005

CMD ["tsx", "src/server.ts"]
