// Centralizes Redis connection environment variables injected into the worker container
// (configured via docker-compose.yml in development or cloud config in production).
module.exports = {
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
};
