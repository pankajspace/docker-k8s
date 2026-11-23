# Production multi-stage Dockerfile for single-container deployment (zero Nginx).
# Stage 1 compiles the React/Vite SPA; Stage 2 runs Express to serve both the API
# and the compiled static React bundle from a single container on port 5000.
#
# Build: docker build -t client-server-local .
# Run:   docker run -p 5000:5000 client-server-local

# --- Stage 1: Build React Frontend ---
FROM node:lts-alpine AS client-builder

WORKDIR /app/client

# Copy client lockfiles first to leverage Docker layer caching.
COPY client/package*.json ./
RUN npm ci

# Copy client source and build with an empty VITE_API_URL so fetch() uses
# same-origin relative URLs (/values) against Express.
COPY client/ ./
ENV VITE_API_URL=""
RUN npm run build

# --- Stage 2: Production Express Server (API + Static SPA) ---
FROM node:lts-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production-only server dependencies (omits nodemon).
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy Express server source code.
COPY server/ ./

# Copy the compiled Vite static bundle into /app/public so Express serves it directly.
COPY --from=client-builder /app/client/dist ./public

# Document default listening port (overridable via PORT env var at runtime).
EXPOSE 5000

# Start Express in production mode using exec form for clean SIGTERM handling.
CMD ["npm", "run", "start"]
