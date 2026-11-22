import React, { useState, useEffect, useCallback } from "react";
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Requests calculated index->value pairs from Redis (routed through Nginx '/api' -> Express '/values/current').
  const fetchValues = useCallback(async () => {
    const res = await axios.get("/api/values/current");
    setValues(res.data || {});
  }, []);

  // Requests all previously submitted indexes from PostgreSQL (routed through Nginx '/api' -> Express '/values/all').
  const fetchIndexes = useCallback(async () => {
    const res = await axios.get("/api/values/all");
    setSeenIndexes(Array.isArray(res.data) ? res.data : []);
  }, []);

  const refreshData = useCallback(async () => {
    try {
      await Promise.all([fetchValues(), fetchIndexes()]);
    } catch (err) {
      // Ignore transient load errors until services finish booting
    }
  }, [fetchValues, fetchIndexes]);

  // Fetch initial data from both data stores (via the Express API) once when the component mounts.
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Submits a new index to Express, which records it in Postgres and triggers async calculation via Redis Pub/Sub.
  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = index.trim();
    if (!trimmed) {
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      await axios.post("/api/values", { index: trimmed });
      setIndex("");
      await refreshData();
      // Poll once more shortly after so async worker results appear without manual reload
      setTimeout(() => {
        refreshData();
      }, 600);
    } catch (err) {
      const message =
        err?.response?.data || "Unable to submit index. Please try again.";
      setError(typeof message === "string" ? message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const sortedEntries = Object.entries(values).sort(
    ([a], [b]) => Number(a) - Number(b)
  );

  return (
    <div>
      <div className="page-header">
        <h1>Fibonacci Calculator</h1>
        <p className="page-subtitle">
          Submit an index to compute its Fibonacci number asynchronously via
          Redis Pub/Sub and record history in PostgreSQL.
        </p>
      </div>

      {/* Form to submit a new Fibonacci index (indexes > 40 are rejected by the API with HTTP 422) */}
      <section className="card">
        <form className="fib-form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="fib-index" className="form-label">
              Enter your index
            </label>
            <input
              id="fib-index"
              type="number"
              min="0"
              max="40"
              className="form-input"
              placeholder="e.g. 7 (max 40)"
              value={index}
              onChange={(event) => setIndex(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || index.trim() === ""}
          >
            {submitting ? "Calculating..." : "Calculate"}
          </button>
        </form>
        <p className="form-hint">
          Values above 40 are capped by the API to keep recursive worker
          calculations fast.
        </p>
        {error && (
          <div className="alert-error" role="alert">
            {error}
          </div>
        )}
      </section>

      {/* Historical indexes persisted in PostgreSQL */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            Indexes I have seen
            <span className="badge badge-purple">PostgreSQL</span>
          </h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={refreshData}
          >
            Refresh
          </button>
        </div>
        {seenIndexes.length > 0 ? (
          <div className="index-list">
            {seenIndexes.map(({ number }, idx) => (
              <span key={`${number}-${idx}`} className="index-chip">
                {number}
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-state">No indexes submitted yet.</p>
        )}
      </section>

      {/* Calculated Fibonacci results cached in Redis by the background worker */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            Calculated Values
            <span className="badge">Redis</span>
          </h2>
        </div>
        {sortedEntries.length > 0 ? (
          <div className="values-grid">
            {sortedEntries.map(([key, val]) => {
              const isPending = val === "Nothing yet!";
              return (
                <div key={key} className="value-item">
                  <span className="value-key">fib({key})</span>
                  <span
                    className={isPending ? "value-pending" : "value-result"}
                  >
                    {val}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">
            Submit an index above to calculate its Fibonacci value.
          </p>
        )}
      </section>
    </div>
  );
};

export default Fib;
