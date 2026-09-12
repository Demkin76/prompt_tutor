import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { App } from "../App";

export function AuthGate() {
  const { signOut } = useAuthActions();

  return (
    <>
      <AuthLoading>
        <div className="loading">CHECKING CREDENTIALS...</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <App onSignOut={() => void signOut()} />
      </Authenticated>
    </>
  );
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await signIn("password", new FormData(event.currentTarget));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="panel auth-card" onSubmit={(event) => void submit(event)}>
        <h2>ENTER THE DUNGEON</h2>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />
        </label>
        <input name="flow" type="hidden" value="signIn" />
        {error && <div className="error">{error}</div>}
        <button className="btn primary big" type="submit" disabled={pending}>
          {pending ? "WORKING..." : "SIGN IN"}
        </button>
      </form>
    </main>
  );
}
