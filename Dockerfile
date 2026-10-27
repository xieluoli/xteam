FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && mkdir /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100 XTEAM_DATABASE=/data/xteam.db
USER node
EXPOSE 3100
CMD ["pnpm", "start"]
