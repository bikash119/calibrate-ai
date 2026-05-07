import { useCallback, useState } from "react";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }, [login, username, password]);

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-sm p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-1">
          Calibrate AI
        </h1>
        <p className="text-sm text-[var(--fg-muted)] text-center mb-7">
          Sign in to continue
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-[var(--radius-sm)] text-sm bg-[var(--red-bg)] border border-[var(--red-border)] text-[var(--red-fg)]">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <label className="block text-xs font-medium mb-1 text-[var(--fg-muted)]">
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="w-full px-3 py-2 mb-4 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-sm"
            required
            autoFocus
            autoComplete="username"
          />
          <label className="block text-xs font-medium mb-1 text-[var(--fg-muted)]">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3 py-2 mb-6 rounded-[var(--radius-sm)] bg-[var(--bg)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-sm"
            required
            autoComplete="current-password"
          />
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={loading || !username.trim() || !password.trim()}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
