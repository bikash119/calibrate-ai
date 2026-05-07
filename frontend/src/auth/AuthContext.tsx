import { createContext, useContext, useState, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

const TOKEN_KEY = "scoring_ai_token";
const USER_KEY = "scoring_ai_user";

/** Read the persisted session synchronously so AuthProvider can use it as a
 *  lazy initializer for useState — no effect-then-setState dance needed. */
function readPersistedSession(): { user: AuthUser | null; token: string | null } {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const userJson = localStorage.getItem(USER_KEY);
    if (token && userJson) {
      return { user: JSON.parse(userJson) as AuthUser, token };
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  return { user: null, token: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy initializer reads localStorage exactly once during mount; nothing
  // is async, so `loading` is always false. Kept in the API for backward
  // compatibility with consumers that gate on it.
  const [{ user, token }, setSession] = useState(readPersistedSession);
  const setUser = (u: AuthUser | null) => setSession((s) => ({ ...s, user: u }));
  const setToken = (t: string | null) => setSession((s) => ({ ...s, token: t }));
  const loading = false;

  const login = async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: "Login failed" }));
      throw new Error(error.detail || "Login failed");
    }

    // New API: flat user fields + access_token (not token + nested user)
    const data = (await res.json()) as {
      access_token: string;
      user_id: number;
      username: string;
      role: string;
      display_name: string | null;
    };
    const u: AuthUser = {
      id: data.user_id,
      username: data.username,
      role: data.role,
      display_name: data.display_name,
    };
    setToken(data.access_token);
    setUser(u);
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
