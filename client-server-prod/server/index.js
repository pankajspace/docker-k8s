// ============================================================================
// Express Production API Setup (AWS EC2 + Caddy Reverse Proxy)
// ============================================================================
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Hide Express version header in production responses.
app.disable("x-powered-by");
// Trust the first proxy hop (Caddy) so req.ip and req.protocol reflect the client.
app.set("trust proxy", 1);

// Allow cross-origin requests only from configured frontend origins (comma-separated).
// Example: CLIENT_ORIGIN=https://fib1.techtoday.click
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (health checks, curl) or open mode if CLIENT_ORIGIN is unset.
      if (!origin || allowedOrigins.length === 0) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  })
);

// Parse incoming JSON request bodies (e.g., { index: "7" } on POST /values).
app.use(express.json());

// ============================================================================
// In-Memory Data Structures
// Note: Because state lives in memory, keep this API at 1 container instance on EC2.
// ============================================================================
const seenIndexes = [];
const calculatedValues = {};

// ============================================================================
// Fibonacci Calculation
// ============================================================================
function fib(index) {
  if (index < 2) return 1;
  return fib(index - 1) + fib(index - 2);
}

// ============================================================================
// Express Route Handlers
// ============================================================================

// Health-check endpoint (GET /)
app.get("/", (req, res) => {
  res.status(200).send("Hi");
});

// Returns both submitted index history and calculated Fibonacci values (GET /values)
app.get("/values", (req, res) => {
  res.json({ seenIndexes, calculatedValues });
});

// Accepts a new Fibonacci index, computes fib(index), and stores it in memory (POST /values)
app.post("/values", (req, res) => {
  const index = req.body.index;
  const parsedIndex = parseInt(index, 10);

  if (Number.isNaN(parsedIndex) || parsedIndex < 0) {
    return res.status(422).send("Invalid index");
  }

  // Guard against overly large indexes because fib() uses exponential O(2^n) recursion.
  if (parsedIndex > 40) {
    return res.status(422).send("Index too high");
  }

  const indexKey = String(parsedIndex);

  seenIndexes.push(parsedIndex);

  if (calculatedValues[indexKey] === undefined) {
    calculatedValues[indexKey] = fib(parsedIndex);
  }

  res.json({ seenIndexes, calculatedValues });
});

// ============================================================================
// Server Startup & Graceful Shutdown
// ============================================================================
const server = app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  if (allowedOrigins.length > 0) {
    console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  } else {
    console.warn("CLIENT_ORIGIN is not set; CORS is currently allowing all origins.");
  }
});

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
