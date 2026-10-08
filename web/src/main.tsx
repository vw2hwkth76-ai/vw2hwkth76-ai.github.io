import "./styles.scss";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Element #root fehlt");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
