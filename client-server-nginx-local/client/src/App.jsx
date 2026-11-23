import "./App.css";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Link,
} from "react-router-dom";
import OtherPage from "./OtherPage";
import Fib from "./Fib";

// Root application component configuring client-side SPA routing via React Router.
function App() {
  return (
    <Router>
      <div className="app-shell">
        <header className="navbar">
          <div className="navbar-inner">
            <Link to="/" className="brand">
              <span className="brand-mark">F</span>
              <span>Fibonacci Calculator</span>
            </Link>

            {/* Client-side navigation links handled without full page reloads */}
            <nav className="nav-links" aria-label="Primary navigation">
              <NavLink to="/" end className="nav-link">
                Calculator
              </NavLink>
              <NavLink to="/otherpage" className="nav-link">
                Other Page
              </NavLink>
            </nav>
          </div>
        </header>

        <main className="main-content">
          {/* Maps URL paths to their corresponding React view components */}
          <Routes>
            {/* Main Fibonacci calculator view */}
            <Route path="/" element={<Fib />} />
            {/* Secondary route used to verify SPA routing (and Nginx try_files fallback in prod) */}
            <Route path="/otherpage" element={<OtherPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
