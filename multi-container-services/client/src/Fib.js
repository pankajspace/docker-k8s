import React, { useState, useEffect } from "react";
import axios from "axios";

// Main Fibonacci calculator component: lets users submit indexes and displays both
// historical indexes (from PostgreSQL) and calculated values (from Redis).
const Fib = () => {
  // List of all submitted index records returned by Postgres: [{ number: 5 }, ...]
  const [seenIndexes, setSeenIndexes] = useState([]);
  // Key-value map of calculated Fibonacci results returned by Redis: { "5": "8", ... }
  const [values, setValues] = useState({});
  // Controlled input state for the index form field
  const [index, setIndex] = useState("");

  // Fetch initial data from both data stores (via the Express API) once when the component mounts.
  useEffect(() => {
    fetchValues();
    fetchIndexes();
  }, []);

  // Requests calculated index->value pairs from Redis (routed through Nginx '/api' -> Express '/values/current').
  const fetchValues = async () => {
    const values = await axios.get("/api/values/current");
    setValues(values.data);
  };

  // Requests all previously submitted indexes from PostgreSQL (routed through Nginx '/api' -> Express '/values/all').
  const fetchIndexes = async () => {
    const seenIndexes = await axios.get("/api/values/all");
    setSeenIndexes(seenIndexes.data);
  };

  // Submits a new index to Express, which records it in Postgres and triggers async calculation via Redis Pub/Sub.
  const handleSubmit = async (event) => {
    event.preventDefault();

    await axios.post("/api/values", {
      index: index,
    });
    // Clear the input field after submission (reload page to fetch newly computed worker result).
    setIndex("");
  };

  // Formats the Postgres rows into a comma-separated list of seen indexes.
  const renderSeenIndexes = () => {
    return seenIndexes.map(({ number }) => number).join(", ");
  };

  // Renders one line per key-value entry retrieved from the Redis 'values' hash.
  const renderValues = () => {
    const entries = [];

    for (let key in values) {
      entries.push(
        <div key={key}>
          For index {key} I calculated {values[key]}
        </div>
      );
    }

    return entries;
  };

  return (
    <div>
      {/* Form to submit a new Fibonacci index (indexes > 40 are rejected by the API with HTTP 422) */}
      <form onSubmit={handleSubmit}>
        <label>Enter your index:</label>
        <input
          value={index}
          onChange={(event) => setIndex(event.target.value)}
        />
        <button>Submit</button>
      </form>

      {/* Historical indexes persisted in PostgreSQL */}
      <h3>Indexes I have seen:</h3>
      {renderSeenIndexes()}

      {/* Calculated Fibonacci results cached in Redis by the background worker */}
      <h3>Calculated Values:</h3>
      {renderValues()}
    </div>
  );
};

export default Fib;
