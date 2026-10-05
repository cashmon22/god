import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCurrentSession, getSessionDuringRateLimit, signOutCurrentSession, supabase } from "./supabase";
import { clearRefreshRateLimit, isRefreshRateLimited } from "./auth-refresh-fetch";

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    try {
      getCurrentSession().then(({ data: { session }, error }) => {
        if (error) {
          if (isMounted) setIsLoading(false);
          return;
        }
        if (!isMounted) return;
        setSession(session);
        setIsLoading(false);
      }).catch(() => {
        if (isMounted) setIsLoading(false);
      });

      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (!session && isRefreshRateLimited()) {
          const storedSession = getSessionDuringRateLimit();
          if (storedSession) {
            setSession(storedSession);
            setIsLoading(false);
            return;
          }
        }
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") clearRefreshRateLimit();
        setSession(session);
        setIsLoading(false);
      });
      subscription = data.subscription;
    } catch {
      // Supabase not configured — load in logged-out state
      setSession(null);
      setIsLoading(false);
    }

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    const { error } = await signOutCurrentSession();
    return { error: error ? new Error(error.message) : null };
  };

  return <AuthContext.Provider value={{ session, isLoading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
