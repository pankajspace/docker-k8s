# Production Dockerfile for the Express API server (deployed on AWS EC2 behind Nginx).

FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

# Copy lockfile and manifest first to leverage Docker layer caching.
COPY package*.json ./

# Install production dependencies only (excludes nodemon and dev tools).
RUN npm ci --omit=dev

# Copy application source and assign ownership to the built-in non-root node user.
COPY --chown=node:node index.js ./

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/ >/dev/null || exit 1

CMD ["node", "index.js"]
