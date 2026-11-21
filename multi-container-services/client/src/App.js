import React from "react";
import logo from "./logo.svg";
import "./App.css";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import OtherPage from "./OtherPage";
import Fib from "./Fib";

// Root application component configuring client-side SPA routing via React Router.
function App() {
  return (
    <Router>
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <a
            className="App-link"
            href="https://reactjs.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn React
          </a>
          {/* Client-side navigation links handled without full page reloads */}
          <Link to="/">Home</Link>
          <Link to="/otherpage">Other Page</Link>
        </header>

        {/* Maps URL paths to their corresponding React view components */}
        <Routes>
          {/* Main Fibonacci calculator view */}
          <Route path="/" element={<Fib />} />
          {/* Secondary route used to verify SPA routing (and Nginx try_files fallback in prod) */}
          <Route path="/otherpage" element={<OtherPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
