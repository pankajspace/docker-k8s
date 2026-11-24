const keys = require("./keys");
const redis = require("redis");

// ============================================================================
// Redis / Valkey Client Setup (Amazon ElastiCache Serverless)
// ============================================================================
const redisClient = redis.createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
    tls: keys.redisTls,
    reconnectStrategy: (retries) => Math.min(retries * 200, 3000),
  },
});

// Dedicated subscriber connection for Pub/Sub events.
const sub = redisClient.duplicate();

redisClient.on("error", (err) => console.error("Redis client error:", err));
sub.on("error", (err) => console.error("Redis subscriber error:", err));

// ============================================================================
// Fibonacci Calculation
// ============================================================================
function fib(index) {
  if (index < 2) return 1;
  return fib(index - 1) + fib(index - 2);
}

// ============================================================================
// Event Subscription & Graceful Shutdown
// ============================================================================
async function start() {
  await Promise.all([redisClient.connect(), sub.connect()]);
  await sub.subscribe("insert", async (message) => {
    try {
      const value = fib(Number.parseInt(message, 10));
      await redisClient.hSet("values", message, String(value));
    } catch (err) {
      console.error(`Failed to compute Fibonacci for index ${message}:`, err);
    }
  });
  console.log("Worker subscribed to 'insert' channel");
}

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down worker gracefully...`);
  await Promise.allSettled([
    sub.isOpen ? sub.quit() : Promise.resolve(),
    redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Worker startup error:", err);
  process.exit(1);
});
