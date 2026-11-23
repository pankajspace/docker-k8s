const keys = require("./keys");
const redis = require("redis");

// ============================================================================
// Redis Client Setup
// ============================================================================
// Primary Redis client used for writing calculated Fibonacci results back to the 'values' hash.
const redisClient = redis.createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
    // Retry connecting every 1000ms if Redis is unavailable or still booting.
    reconnectStrategy: () => 1000,
  },
});

// Duplicate Redis connection dedicated exclusively to Pub/Sub subscriptions.
// Once a client enters subscriber mode, it cannot issue normal commands like hSet.
const sub = redisClient.duplicate();

redisClient.on("error", (err) => console.error("Redis client error:", err));
sub.on("error", (err) => console.error("Redis subscriber error:", err));

// ============================================================================
// Fibonacci Calculation
// ============================================================================
// Intentionally uses a naive recursive O(2^n) implementation to simulate a slow,
// CPU-intensive task that justifies offloading work to a separate worker container.
function fib(index) {
  if (index < 2) return 1;
  return fib(index - 1) + fib(index - 2);
}

// ============================================================================
// Event Subscription
// ============================================================================
// Connect both Redis clients, then listen on the 'insert' channel for new indexes
// published by the Express API and overwrite the 'Nothing yet!' placeholder.
async function start() {
  await Promise.all([redisClient.connect(), sub.connect()]);
  await sub.subscribe("insert", (message) => {
    redisClient.hSet("values", message, fib(parseInt(message)));
  });
}

start().catch((err) => console.error("Worker startup error:", err));
