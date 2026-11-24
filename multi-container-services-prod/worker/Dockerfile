# Production Dockerfile for the background Fibonacci worker (deployed on Amazon ECS Fargate).

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

CMD ["node", "index.js"]
