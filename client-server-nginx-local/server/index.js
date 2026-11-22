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
// In-Memory Data Structures (replaces PostgreSQL & Redis)
// ============================================================================
// Stores the history of all submitted indexes as [{ number: <int> }, ...]
const seenIndexes = [];

// Stores calculated Fibonacci values as { "<index>": <calculatedValue>, ... }
const calculatedValues = {};

// ============================================================================
// Fibonacci Calculation (moved from the separate worker service)
// ============================================================================
function fib(index) {
  if (index < 2) return 1;
  return fib(index - 1) + fib(index - 2);
}

// ============================================================================
// Express Route Handlers
// (Nginx strips the '/api' prefix before forwarding requests to these routes.)
// ============================================================================

// Simple health-check / sanity endpoint (GET /api/).
app.get("/", (req, res) => {
  res.send("Hi");
});

// Returns every Fibonacci index submitted since server start (GET /api/values/all).
app.get("/values/all", (req, res) => {
  res.send(seenIndexes);
});

// Returns the map of { index: calculatedValue } stored in memory (GET /api/values/current).
app.get("/values/current", (req, res) => {
  res.send(calculatedValues);
});

// Accepts a new Fibonacci index, computes fib(index) on the server, and stores it in memory (POST /api/values).
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
  seenIndexes.push({ number: parsedIndex });

  // Compute and cache the Fibonacci value in the in-memory map
  if (calculatedValues[indexKey] === undefined) {
    calculatedValues[indexKey] = fib(parsedIndex);
  }

  res.send({ working: true });
});

// Start listening on internal port 5000 (targeted by Nginx's 'api:5000' upstream).
app.listen(5000, () => {
  console.log("Listening on port 5000");
});
