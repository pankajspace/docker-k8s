import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Locate the root DOM mount point defined in public/index.html and bootstrap the React 18 app.
const container = document.getElementById("root");
const root = createRoot(container);

root.render(<App />);
