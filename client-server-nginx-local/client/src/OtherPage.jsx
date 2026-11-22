import React from "react";
import { Link } from "react-router-dom";

// Secondary page demonstrating client-side navigation with React Router.
// Directly refreshing '/otherpage' in production relies on client/nginx/default.conf's try_files rule.
const OtherPage = () => {
  return (
    <div>
      <div className="page-header">
        <h1>Other Page</h1>
        <p className="page-subtitle">
          Secondary client-side route powered by React Router.
        </p>
      </div>

      <section className="card other-page-card">
        <p>
          This route verifies single-page application navigation without full
          page reloads, as well as Nginx&apos;s <code>try_files</code> fallback
          when refreshing directly on <code>/otherpage</code>.
        </p>
        <Link to="/" className="btn btn-primary">
          Back to Calculator
        </Link>
      </section>
    </div>
  );
};

export default OtherPage;
