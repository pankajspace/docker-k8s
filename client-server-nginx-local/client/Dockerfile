# Production multi-stage Dockerfile for the React frontend.
# Stage 1 compiles the Vite/React app; Stage 2 serves only the static output via Nginx.

# --- Stage 1: Build Stage ---
# Use the lightweight Alpine Linux variant of Node.js LTS to compile the production bundle.
# Naming this stage 'builder' allows Stage 2 to copy artifacts from it while discarding Node.js.
FROM node:lts-alpine AS builder

# Set /app as the working directory inside the build container for all subsequent instructions.
WORKDIR '/app'

# Copy package.json and package-lock.json first so Docker caches the dependency layer
# and skips reinstalling packages when only application source code changes.
COPY ./package*.json ./

# Perform a clean, deterministic install of all dependencies (including Vite devDependencies
# needed to compile the production bundle) matching exact versions in package-lock.json.
RUN npm ci

# Copy the rest of the React application source code into /app.
COPY . .

# Compile and minify the React application into static assets under /app/dist.
RUN npm run build

# --- Stage 2: Production Runtime Stage ---
# Start from a minimal Nginx Alpine image so the final image contains only Nginx and static files,
# excluding Node.js, source code, and node_modules for a smaller footprint and attack surface.
FROM nginx:alpine

# Document that this container listens on port 3000 (matching the outer Nginx reverse-proxy upstream).
EXPOSE 3000

# Replace Nginx's default site config with the client-specific config that listens on port 3000
# and falls back to /index.html via try_files so React Router client-side routes work on refresh.
COPY ./nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy only the compiled static assets from Stage 1 into Nginx's default web root.
# Nginx's base image CMD automatically starts the server in the foreground.
COPY --from=builder /app/dist /usr/share/nginx/html
