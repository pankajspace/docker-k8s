# Production Nginx reverse-proxy Dockerfile.
# Routes incoming HTTP traffic to the React client (/) and Express API (/api) containers.

# Use the minimal Alpine Linux variant of the official Nginx image to keep image size small.
# The base image already exposes port 80 and starts Nginx in the foreground by default.
FROM nginx:alpine

# Overwrite Nginx's default server block with our custom reverse-proxy routing configuration.
COPY ./default.conf /etc/nginx/conf.d/default.conf
