# Development Dockerfile for the React frontend (used by docker-compose.yml).

# Use the lightweight Alpine Linux variant of the Node.js LTS image to keep image size small.
FROM node:lts-alpine

# Set /app as the working directory inside the container for all subsequent instructions.
WORKDIR '/app'

# Copy package.json and package-lock.json first so Docker caches the dependency layer
# and skips reinstalling packages when only application source code changes.
COPY ./package*.json ./

# Perform a clean, deterministic install matching exact versions in package-lock.json.
# At runtime, docker-compose.yml preserves /app/node_modules with an anonymous volume.
RUN npm ci

# Copy the remaining application source code into /app so the image can run standalone.
# In docker-compose.yml, ./client:/app overrides this at runtime for live hot-reloading.
COPY . .

# Document that the Vite dev server listens on port 3000.
EXPOSE 3000

# Launch Vite's live-reloading development server on container port 3000 (defined in package.json).
# Uses exec form (JSON array) so OS signals like SIGTERM are handled cleanly on container stop.
CMD ["npm", "run", "start"]
