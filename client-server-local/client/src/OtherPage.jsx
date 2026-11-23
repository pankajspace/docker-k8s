import { Link } from "react-router-dom";

// Secondary page demonstrating client-side navigation with React Router.
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
          page reloads.
        </p>
        <Link to="/" className="btn btn-primary">
          Back to Calculator
        </Link>
      </section>
    </div>
  );
};

export default OtherPage;
