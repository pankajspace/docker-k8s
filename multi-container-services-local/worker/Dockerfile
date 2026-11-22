# Production Dockerfile for the background Fibonacci worker.
FROM node:lts-alpine
WORKDIR "/app"

# Copy package.json first to leverage Docker layer caching during dependency installation.
COPY ./package.json ./
RUN npm install

# Copy the worker source code into the image.
COPY . .

# Start the worker process directly with Node.js to listen for Redis 'insert' events.
CMD ["npm", "run", "start"]
