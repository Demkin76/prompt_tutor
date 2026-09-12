import { loadAssets } from "./assets";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { App } from "./App";
import { CONVEX_URL } from "./api";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (CONVEX_URL) {
  const client = new ConvexReactClient(CONVEX_URL);
  root.render(
    <React.StrictMode>
      <ConvexAuthProvider client={client}>
        <AuthGate />
      </ConvexAuthProvider>
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
