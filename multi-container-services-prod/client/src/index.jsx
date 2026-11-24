import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Locate the root DOM mount point defined in index.html and bootstrap the React 18 app.
createRoot(document.getElementById("root")).render(<App />);
