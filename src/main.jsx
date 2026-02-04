import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

/**
 * Application entry point.
 *
 * - Creates the React root.
 * - Wraps the application in StrictMode to highlight
 *   potential side-effects and unsafe lifecycle usage during development.
 * - Mounts the App component into the DOM.
 */
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
