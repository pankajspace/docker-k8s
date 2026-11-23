// ============================================================================
// Express App Setup
// ============================================================================
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;
const clientDistPath = path.join(__dirname, "public");
const hasClientBundle = fs.existsSync(path.join(clientDistPath, "index.html"));

// Allow cross-origin requests in development (React dev server on :3000 -> Express on :5000).
// In single-container production, the SPA is served from the same origin.
app.use(cors());
// Parse incoming JSON request bodies (e.g., { index: "7" } on POST /values).
app.use(express.json());

// ============================================================================
// In-Memory Data Structures (replaces PostgreSQL & Redis)
// ============================================================================
// Stores the history of all submitted indexes as [<int>, ...]
const seenIndexes = [];

// Stores calculated Fibonacci values as { "<index>": <calculatedValue>, ... }
const calculatedValues = {};

// ============================================================================
// Fibonacci Calculation (runs directly inside the Express server)
// ============================================================================
function fib(index) {
  if (index < 2) return 1;
  return fib(index - 1) + fib(index - 2);
}

// ============================================================================
// Express Route Handlers
// ============================================================================

// Health-check endpoint (works in both development and single-container production).
app.get("/health", (req, res) => {
  res.send({ status: "ok" });
});

// Returns both submitted index history and calculated Fibonacci values (GET /values).
app.get("/values", (req, res) => {
  res.send({ seenIndexes, calculatedValues });
});

// Accepts a new Fibonacci index, computes fib(index) on the server, and stores it in memory (POST /values).
app.post("/values", (req, res) => {
  const index = req.body.index;
  const parsedIndex = parseInt(index, 10);

  if (Number.isNaN(parsedIndex) || parsedIndex < 0) {
    return res.status(422).send("Invalid index");
  }

  // Guard against overly large indexes because fib() uses an exponential O(2^n) recursive algorithm.
  if (parsedIndex > 40) {
    return res.status(422).send("Index too high");
  }

  const indexKey = String(parsedIndex);

  // Record submitted index in the in-memory list
  seenIndexes.push(parsedIndex);

  // Compute and cache the Fibonacci value in the in-memory map
  if (calculatedValues[indexKey] === undefined) {
    calculatedValues[indexKey] = fib(parsedIndex);
  }

  res.send({ seenIndexes, calculatedValues });
});

// ============================================================================
// Production Static SPA Serving (Single-Container Mode, Zero Nginx)
// ============================================================================
if (hasClientBundle) {
  // Serve compiled Vite static assets (JS, CSS, icons, etc.) from ./public.
  app.use(express.static(clientDistPath));

  // SPA fallback: return index.html for client-side React Router paths (e.g., /otherpage).
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
} else {
  // Development sanity endpoint when the React client runs separately on :3000.
  app.get("/", (req, res) => {
    res.send("Hi");
  });
}

// Start listening on PORT (defaults to 5000).
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
