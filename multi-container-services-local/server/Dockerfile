# Production Dockerfile for the Express API server.
FROM node:lts-alpine
WORKDIR "/app"

# Copy package manifests first to leverage Docker layer caching during dependency installation.
COPY ./package*.json ./
RUN npm ci --omit=dev

# Copy the server source code into the image.
COPY . .

# Run the Express server directly with Node.js (listens on port 5000).
CMD ["npm", "run", "start"]
