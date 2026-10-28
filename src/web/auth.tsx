import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, post, setAuthErrorHandler } from './api';

export type Stage = 'full' | 'password_change' | 'mfa_verify' | 'mfa_enroll';

export interface Me {
  id: number;
  email: string;
  displayName: string;
  role: string;
  teamIds: number[];
  locale: string;
  theme: 'light' | 'dark';
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  isBootstrapAdmin: boolean;
  telegramChatId: string | null;
}

interface AuthState {
  user: Me | null;
  stage: Stage | null;
  permissions: string[];
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (stage: Stage, user: Me) => void;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await get<{ stage: Stage; user: Me; permissions: string[] }>('/auth/me');
      setUser(me.user);
      setStage(me.stage);
      setPermissions(me.permissions);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err;
      setUser(null);
      setStage(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthErrorHandler(() => void refresh());
    void refresh();
  }, [refresh]);

  const setSession = (s: Stage, u: Me) => {
    setStage(s);
    setUser(u);
    void refresh();
  };

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    setUser(null);
    setStage(null);
    setPermissions([]);
  };

  const can = (p: string) => permissions.includes('*') || permissions.includes(p);

  return (
    <AuthContext.Provider value={{ user, stage, permissions, loading, refresh, setSession, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
