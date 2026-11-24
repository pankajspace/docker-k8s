# Production Dockerfile for the Express API server (deployed on Amazon ECS Fargate).

FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Copy lockfile and manifest first to leverage Docker layer caching.
COPY package*.json ./

# Install production dependencies only.
RUN npm ci --omit=dev

# Copy application source and assign ownership to the built-in non-root node user.
COPY --chown=node:node index.js keys.js ./

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1

CMD ["node", "index.js"]
