import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  const pollTimerRef = useRef(null);

  // Requests calculated values (Redis) and submitted indexes (PostgreSQL) in parallel.
  const refreshData = useCallback(async () => {
    try {
      const [valuesRes, indexesRes] = await Promise.all([
        axios.get("/api/values/current"),
        axios.get("/api/values/all"),
      ]);
      setValues(valuesRes.data || {});
      setSeenIndexes(Array.isArray(indexesRes.data) ? indexesRes.data : []);
    } catch {
      // Ignore transient load errors until services finish booting
    }
  }, []);

  // Fetch initial data on mount and clean up any pending post-submit refresh timer on unmount.
  useEffect(() => {
    refreshData();
    return () => clearTimeout(pollTimerRef.current);
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
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(refreshData, 600);
    } catch (err) {
      const message =
        err?.response?.data || "Unable to submit index. Please try again.";
      setError(typeof message === "string" ? message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const sortedEntries = useMemo(
    () => Object.entries(values).sort(([a], [b]) => Number(a) - Number(b)),
    [values]
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
