# Production Dockerfile for the Express API server.

# Use the lightweight Alpine Linux variant of the Node.js LTS image to keep image size small.
FROM node:lts-alpine

# Set /app as the working directory inside the container for all subsequent instructions.
WORKDIR "/app"

# Copy package.json and package-lock.json first so Docker caches the dependency layer
# and skips reinstalling packages when only server source code changes.
COPY ./package*.json ./

# Perform a clean, deterministic install of production dependencies only (--omit=dev skips
# development tools like nodemon to reduce final image size and attack surface).
RUN npm ci --omit=dev

# Copy the Express server source code into /app.
COPY . .

# Run the Express API server directly with Node.js on container port 5000 (defined in package.json).
# Uses exec form (JSON array) so OS signals like SIGTERM are handled cleanly on container stop.
CMD ["npm", "run", "start"]
