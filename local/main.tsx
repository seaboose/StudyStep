import React from "react";
import { createRoot } from "react-dom/client";
import LocalApp from "./LocalApp";
import "../app/study.css";
import "./local.css";
import "./direct-flow.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalApp />
  </React.StrictMode>,
);
