import { useState, useEffect, useCallback, useMemo } from "react";

// API base URL: defaults to http://localhost:5000 in dev; set VITE_API_URL="" in single-container prod for same-origin requests.
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:5000"
).replace(/\/+$/, "");

// Main Fibonacci calculator component: lets users submit indexes and displays both
// historical indexes and calculated values stored in memory on the Node.js server.
const Fib = () => {
  // List of all submitted indexes returned by the server: [5, ...]
  const [seenIndexes, setSeenIndexes] = useState([]);
  // Key-value map of calculated Fibonacci results returned by the server: { "5": 8, ... }
  const [values, setValues] = useState({});
  // Controlled input state for the index form field
  const [index, setIndex] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const applyServerData = useCallback((data = {}) => {
    setSeenIndexes(Array.isArray(data.seenIndexes) ? data.seenIndexes : []);
    setValues(data.calculatedValues || {});
  }, []);

  // Requests both submitted indexes and calculated values directly from Express (GET http://localhost:5000/values).
  const refreshData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/values`);
      if (!res.ok) return;
      applyServerData(await res.json());
    } catch {
      // Ignore transient load errors until services finish booting
    }
  }, [applyServerData]);

  // Fetch initial data from the Express API once when the component mounts.
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Submits a new index directly to Express, which calculates fib(index) and returns the updated state.
  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = index.trim();
    if (!trimmed) {
      return;
    }

    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/values`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: trimmed }),
      });
      if (!res.ok) {
        const message = await res.text();
        setError(message || "Unable to submit index. Please try again.");
        return;
      }
      setIndex("");
      applyServerData(await res.json());
    } catch {
      setError("Unable to submit index. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const sortedEntries = useMemo(
    () =>
      Object.entries(values).sort(([a], [b]) => Number(a) - Number(b)),
    [values]
  );

  return (
    <div>
      <div className="page-header">
        <h1>Fibonacci Calculator</h1>
        <p className="page-subtitle">
          Submit an index to compute its Fibonacci number directly on the
          Express server and store results in memory.
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
          Values above 40 are capped by the API to keep recursive server
          calculations fast.
        </p>
        {error && (
          <div className="alert-error" role="alert">
            {error}
          </div>
        )}
      </section>

      {/* Historical indexes stored in an in-memory array on the server */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            Indexes I have seen
            <span className="badge badge-purple">In-Memory List</span>
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
            {seenIndexes.map((number, idx) => (
              <span key={`${number}-${idx}`} className="index-chip">
                {number}
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-state">No indexes submitted yet.</p>
        )}
      </section>

      {/* Calculated Fibonacci results stored in an in-memory map on the server */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            Calculated Values
            <span className="badge">In-Memory Map</span>
          </h2>
        </div>
        {sortedEntries.length > 0 ? (
          <div className="values-grid">
            {sortedEntries.map(([key, val]) => (
              <div key={key} className="value-item">
                <span className="value-key">fib({key})</span>
                <span className="value-result">{val}</span>
              </div>
            ))}
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
