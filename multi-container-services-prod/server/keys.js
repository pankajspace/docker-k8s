// Environment configuration for the production Express API running on ECS Fargate.
module.exports = {
  port: Number(process.env.PORT) || 5000,

  // Redis / ElastiCache for Valkey connection settings
  redisHost: process.env.REDIS_HOST,
  redisPort: Number(process.env.REDIS_PORT) || 6379,
  redisTls: process.env.REDIS_TLS === "true",

  // PostgreSQL / Amazon RDS connection settings
  pgUser: process.env.PGUSER,
  pgHost: process.env.PGHOST,
  pgDatabase: process.env.PGDATABASE,
  pgPassword: process.env.PGPASSWORD,
  pgPort: Number(process.env.PGPORT) || 5432,
  pgSsl: process.env.PGSSL !== "false",
};
