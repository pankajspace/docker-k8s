# Development Dockerfile for the background Fibonacci worker (used by docker-compose.yml).

# Use the lightweight Alpine Linux variant of the Node.js LTS image to keep image size small.
FROM node:lts-alpine

# Set /app as the working directory inside the container for all subsequent instructions.
WORKDIR "/app"

# Copy package.json and package-lock.json first so Docker caches the dependency layer
# and skips reinstalling packages when only worker source code changes.
COPY ./package*.json ./

# Perform a clean, deterministic install of all dependencies (including nodemon) from package-lock.json.
# At runtime, docker-compose.yml preserves /app/node_modules with an anonymous volume.
RUN npm ci

# Copy the worker source code into /app so the image can run standalone.
# In docker-compose.yml, ./worker:/app overrides this at runtime for live reloading.
COPY . .

# Start the worker via nodemon so it automatically restarts on source file edits while listening to Redis.
# Uses exec form (JSON array) so OS signals like SIGTERM are handled cleanly on container stop.
CMD ["npm", "run", "dev"]
