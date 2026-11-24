const keys = require("./keys");
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const redis = require("redis");

// ============================================================================
// Express App Setup
// ============================================================================
const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json());

// ============================================================================
// PostgreSQL Client Setup (Amazon RDS for PostgreSQL)
// ============================================================================
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl: keys.pgSsl ? { rejectUnauthorized: false } : false,
});

pgClient.on("error", (err) => {
  console.error("PostgreSQL pool error:", err);
});

async function initDatabase() {
  await pgClient.query("CREATE TABLE IF NOT EXISTS values (number INT)");
}

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

redisClient.on("error", (err) => console.error("Redis error:", err));

// ============================================================================
// Health Check Endpoints (ALB Target Group & Container HEALTHCHECK)
// ============================================================================
app.get("/", (_req, res) => {
  res.status(200).send("Hi");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ============================================================================
// API Route Handlers
// Mounted under /api so CloudFront can forward /api/* directly to the ALB
// without needing a URL-rewrite function.
// ============================================================================
const apiRouter = express.Router();

apiRouter.get("/", (_req, res) => {
  res.status(200).send("Hi");
});

apiRouter.get("/values/all", async (_req, res, next) => {
  try {
    const values = await pgClient.query("SELECT * FROM values");
    res.json(values.rows);
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/values/current", async (_req, res, next) => {
  try {
    const values = await redisClient.hGetAll("values");
    res.json(values);
  } catch (err) {
    next(err);
  }
});

apiRouter.post("/values", async (req, res, next) => {
  try {
    const index = String(req.body.index ?? "").trim();
    const parsed = Number.parseInt(index, 10);

    if (!Number.isInteger(parsed) || parsed < 0) {
      return res.status(400).send("Invalid index");
    }

    if (parsed > 40) {
      return res.status(422).send("Index too high");
    }

    await redisClient.hSet("values", index, "Nothing yet!");
    await Promise.all([
      redisClient.publish("insert", index),
      pgClient.query("INSERT INTO values(number) VALUES($1)", [parsed]),
    ]);

    res.json({ working: true });
  } catch (err) {
    next(err);
  }
});

app.use("/api", apiRouter);

app.use((err, _req, res, _next) => {
  console.error("Unhandled API error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ============================================================================
// Startup & Graceful Shutdown (ECS SIGTERM handling)
// ============================================================================
let server;

async function start() {
  await redisClient.connect();
  await initDatabase();

  server = app.listen(keys.port, () => {
    console.log(`API listening on port ${keys.port}`);
  });
}

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  if (server) {
    server.close();
  }
  await Promise.allSettled([
    redisClient.isOpen ? redisClient.quit() : Promise.resolve(),
    pgClient.end(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
