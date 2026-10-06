import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCurrentSession, getSessionDuringRateLimit, signOutCurrentSession, supabase } from "./supabase";
import { clearRefreshRateLimit, isRefreshRateLimited } from "./auth-refresh-fetch";

type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  authError: boolean;
  retrySession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isSessionRevokedError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  if ("status" in error && error.status === 401) return true;
  return "code" in error && ["invalid_grant", "refresh_token_not_found", "refresh_token_already_used", "session_expired"].includes(String(error.code));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let receivedResolvedAuthEvent = false;
    let preservedRateLimitedSession = false;
    let mounted = true;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.info("[auth] state-change", { event, hasSession: Boolean(nextSession), cooldownActive: isRefreshRateLimited() });
      if (!nextSession && isRefreshRateLimited()) {
        if (preservedRateLimitedSession) return;
        const storedSession = getSessionDuringRateLimit();
        if (storedSession) {
          preservedRateLimitedSession = true;
          receivedResolvedAuthEvent = true;
          setSession(storedSession);
          setAuthError(false);
          setIsLoading(false);
          return;
        }
      }
      if (event === "INITIAL_SESSION" && !nextSession) return;
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        preservedRateLimitedSession = false;
        clearRefreshRateLimit();
      }
      receivedResolvedAuthEvent = true;
      setSession(nextSession);
      setAuthError(false);
      setIsLoading(false);
    });
    void getCurrentSession("auth-provider:init").then(({ data: { session: currentSession }, error }) => {
      if (!mounted) return;
      if (error) {
        if (!receivedResolvedAuthEvent) {
          setSession(null);
          setAuthError(!isSessionRevokedError(error));
        }
      } else if (!receivedResolvedAuthEvent) {
        setSession(currentSession);
        setAuthError(false);
      }
      setIsLoading(false);
    }).catch(() => {
      if (!mounted) return;
      if (!receivedResolvedAuthEvent) setAuthError(true);
      setIsLoading(false);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const retrySession = async () => {
    setIsLoading(true);
    setAuthError(false);
    try {
      const { data: { session: currentSession }, error } = await getCurrentSession("auth-provider:retry");
      if (error) throw error;
      setSession(currentSession);
    } catch (error) {
      if (isSessionRevokedError(error)) {
        setSession(null);
        setAuthError(false);
      } else {
        setAuthError(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    const { error } = await signOutCurrentSession();
    return { error: error ? new Error(error.message) : null };
  };

  return <AuthContext.Provider value={{ session, isLoading, authError, retrySession, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
