import { loadAssets } from "./assets";
import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { CONVEX_URL } from "./api";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (CONVEX_URL) {
  const client = new ConvexReactClient(CONVEX_URL);
  root.render(
    <React.StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void loadAssets();
