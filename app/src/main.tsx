import { loadAssets } from "./assets";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { App } from "./App";
import { CONVEX_URL } from "./api";
import { AuthGate } from "./components/AuthGate";
import "./styles.css";
import "./site-theme.css";
import { ErrorBoundary } from "./ErrorBoundary";

const root = ReactDOM.createRoot(document.getElementById("root")!);

async function mount() {
  await loadAssets();
  if (CONVEX_URL) {
    const client = new ConvexReactClient(CONVEX_URL);
    root.render(
      <React.StrictMode>
        <ConvexAuthProvider client={client}>
          <ErrorBoundary><AuthGate /></ErrorBoundary>
        </ConvexAuthProvider>
      </React.StrictMode>,
    );
  } else {
    root.render(
      <React.StrictMode>
        <ErrorBoundary><App /></ErrorBoundary>
      </React.StrictMode>,
    );
  }
}
void mount();
