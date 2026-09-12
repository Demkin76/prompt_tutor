import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("GOLEM could not open the facility", error); }
  render() {
    if (this.state.failed) return <main className="restore-run" role="alert"><h1>The facility is unavailable</h1><p>We could not load the game. Check your connection and try again.</p><button className="btn primary" onClick={() => location.reload()}>Try again</button> <a href="index.html">Back to GOLEM</a></main>;
    return this.props.children;
  }
}
