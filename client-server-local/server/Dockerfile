# Development Dockerfile for the Express API server (used by docker-compose.yml).

# Use the lightweight Alpine Linux variant of the Node.js LTS image to keep image size small.
FROM node:lts-alpine

# Set /app as the working directory inside the container for all subsequent instructions.
WORKDIR "/app"

# Copy package.json and package-lock.json first so Docker caches the dependency layer
# and skips reinstalling packages when only server source code changes.
COPY ./package*.json ./

# Perform a clean, deterministic install of all dependencies (including nodemon) from package-lock.json.
# At runtime, docker-compose.yml preserves /app/node_modules with an anonymous volume.
RUN npm ci

# Copy the server source code into /app so the image can run standalone.
# In docker-compose.yml, ./server:/app overrides this at runtime for live reloading.
COPY . .

# Document that the Express dev server listens on port 5000.
EXPOSE 5000

# Start the API server via nodemon (port 5000) so it automatically restarts on source file edits.
# Uses exec form (JSON array) so OS signals like SIGTERM are handled cleanly on container stop.
CMD ["npm", "run", "dev"]
