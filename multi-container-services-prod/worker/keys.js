// Environment configuration for the production Fibonacci worker running on ECS Fargate.
module.exports = {
  redisHost: process.env.REDIS_HOST,
  redisPort: Number(process.env.REDIS_PORT) || 6379,
  redisTls: process.env.REDIS_TLS === "true",
};
