import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Theme, User } from '../lib/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setTheme: (theme: Theme | 'AUTO') => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** Before login (or for guests) follow the same IST rule the server uses. */
function guestTheme(): Theme {
  const istHour = (new Date().getUTCHours() + 5 + Math.floor((new Date().getUTCMinutes() + 30) / 60)) % 24;
  return istHour >= 5 && istHour < 12 ? 'LIGHT' : 'DARK';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get<{ user: User }>('/auth/me');
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [refresh]);

  // Apply the profile theme everywhere.
  useEffect(() => {
    const theme = (user?.theme ?? guestTheme()).toLowerCase();
    document.documentElement.dataset.theme = theme;
  }, [user?.theme]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  const setTheme = useCallback(async (theme: Theme | 'AUTO') => {
    const { user } = await api.put<{ user: User }>('/users/me/theme', { theme });
    setUser(user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, refresh, logout, setTheme }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
