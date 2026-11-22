const keys = require("./keys");

// ============================================================================
// Express App Setup
// ============================================================================
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
// Allow cross-origin requests (useful if the API is accessed directly outside Nginx).
app.use(cors());
// Parse incoming JSON request bodies (e.g., { index: "7" } on POST /values).
app.use(bodyParser.json());

// ============================================================================
// PostgreSQL Client Setup
// ============================================================================
const { Pool } = require("pg");
// Create a connection pool to PostgreSQL for durable storage of all submitted indexes.
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
});

// Automatically ensure the 'values' table exists whenever a new Postgres connection is established.
pgClient.on("connect", (client) => {
  client
    .query("CREATE TABLE IF NOT EXISTS values (number INT)")
    .catch((err) => console.error(err));
});

// ============================================================================
// Redis Client Setup
// ============================================================================
const redis = require("redis");
// Primary Redis client for standard read/write commands (hGetAll, hSet).
const redisClient = redis.createClient({
  socket: {
    host: keys.redisHost,
    port: keys.redisPort,
    // Retry connecting every 1000ms if the connection drops or Redis is still starting up.
    reconnectStrategy: () => 1000,
  },
});

// Dedicated duplicate connection for Pub/Sub publishing; Redis recommends keeping
// Pub/Sub connections separate from normal command connections.
const redisPublisher = redisClient.duplicate();

// Establish connections to Redis (required in redis v4+).
redisClient.connect();
redisPublisher.connect();

// ============================================================================
// Express Route Handlers
// (Nginx strips the '/api' prefix before forwarding requests to these routes.)
// ============================================================================

// Simple health-check / sanity endpoint (GET /api/).
app.get("/", (req, res) => {
  res.send("Hi");
});

// Returns every Fibonacci index ever submitted, queried from PostgreSQL (GET /api/values/all).
app.get("/values/all", async (req, res) => {
  const values = await pgClient.query("SELECT * from values");

  res.send(values.rows);
});

// Returns the current map of { index: calculatedValue } stored in Redis (GET /api/values/current).
app.get("/values/current", async (req, res) => {
  const values = await redisClient.hGetAll("values");
  res.send(values);
});

// Accepts a new Fibonacci index, stores a placeholder, notifies the worker, and logs it in Postgres (POST /api/values).
app.post("/values", async (req, res) => {
  const index = req.body.index;

  // Guard against overly large indexes because the worker uses an exponential O(2^n) recursive algorithm.
  if (parseInt(index) > 40) {
    return res.status(422).send("Index too high");
  }

  // 1. Store a placeholder in the Redis 'values' hash until the worker finishes computing fib(index).
  await redisClient.hSet("values", index, "Nothing yet!");
  // 2. Publish an 'insert' event so the background worker picks up the index asynchronously.
  await redisPublisher.publish("insert", index);
  // 3. Permanently record the submitted index in PostgreSQL.
  pgClient.query("INSERT INTO values(number) VALUES($1)", [index]);

  // Respond immediately without blocking on the background calculation.
  res.send({ working: true });
});

// Start listening on internal port 5000 (targeted by Nginx's 'api:5000' upstream).
app.listen(5000, (err) => {
  console.log("Listening");
});
