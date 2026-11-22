// Centralizes environment variable lookups for external service connections
// (injected via docker-compose.yml in development or cloud config in production).
module.exports = {
  // Redis connection settings (used for caching calculated values and Pub/Sub events)
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,

  // PostgreSQL connection settings (used for persisting all submitted indexes)
  pgUser: process.env.PGUSER,
  pgHost: process.env.PGHOST,
  pgDatabase: process.env.PGDATABASE,
  pgPassword: process.env.PGPASSWORD,
  pgPort: process.env.PGPORT,
};
