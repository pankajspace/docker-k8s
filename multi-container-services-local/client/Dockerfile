# --- Stage 1: Build Stage ---
# Use a lightweight Node.js Alpine image to install dependencies and compile the React production bundle.
FROM node:lts-alpine as builder
WORKDIR '/app'

# Copy package.json first to leverage Docker layer caching when dependencies haven't changed.
COPY ./package.json ./
RUN npm install

# Copy the rest of the React source code and generate the optimized static Vite build in /app/dist.
COPY . .
RUN npm run build

# --- Stage 2: Production Runtime Stage ---
# Use a minimal Nginx image to serve only the compiled static assets (discarding Node.js & node_modules).
FROM nginx

# Document that this container serves the React SPA on port 3000 (matching the outer Nginx upstream).
EXPOSE 3000

# Copy the client-specific Nginx config (listens on 3000 with SPA try_files fallback).
COPY ./nginx/default.conf /etc/nginx/conf.d/default.conf

# Copy the compiled React static files from the builder stage into Nginx's web root.
COPY --from=builder /app/dist /usr/share/nginx/html
