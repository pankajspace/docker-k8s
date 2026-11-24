# Development Nginx reverse-proxy Dockerfile (used by docker-compose.yml).
# Acts as the single entry point (mapped to host port 3050), routing '/' to client and '/api' to api.

# Use the minimal Alpine Linux variant of the official Nginx image to keep image size small.
# The base image already exposes port 80 and starts Nginx in the foreground by default.
FROM nginx:alpine

# Overwrite Nginx's default server block with our custom reverse-proxy routing rules
# (including WebSocket upgrade headers so Vite's HMR works seamlessly in development).
COPY ./default.conf /etc/nginx/conf.d/default.conf
