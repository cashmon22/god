// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider, useAuth } from "./auth";
import { supabase } from "./supabase";

const { authState } = vi.hoisted(() => ({
  authState: {
    callback: null as ((event: string, session: unknown) => void) | null,
    activeListeners: 0,
    cooldownActive: false,
    currentSession: { data: { session: null }, error: null } as unknown,
    storedSession: null as unknown,
  },
}));

vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        authState.activeListeners += 1;
        authState.callback = callback;
        return { data: { subscription: { unsubscribe: vi.fn(() => { authState.activeListeners -= 1; }) } } };
      }),
      signInWithPassword: vi.fn(),
      refreshSession: vi.fn(),
    },
  },
  getCurrentSession: vi.fn(() => Promise.resolve(authState.currentSession)),
  getSessionDuringRateLimit: vi.fn(() => authState.storedSession),
  signOutCurrentSession: vi.fn(async () => ({ error: null })),
}));

vi.mock("./auth-refresh-fetch", () => ({
  clearRefreshRateLimit: vi.fn(),
  isRefreshRateLimited: () => authState.cooldownActive,
}));

const savedSession = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "user-1", app_metadata: { role: "admin" }, user_metadata: {} },
};

function LogoutButton() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>Log out</button>;
}

function RoutedDashboard() {
  return (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<><span>Dashboard</span><LogoutButton /></>} />
        </Route>
        <Route path="/login" element={<span>Login</span>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<StrictMode><QueryClientProvider client={queryClient}><AuthProvider><RoutedDashboard /></AuthProvider></QueryClientProvider></StrictMode>);
}

describe("AuthProvider refresh stability", () => {
  beforeEach(() => {
    authState.callback = null;
    authState.activeListeners = 0;
    authState.cooldownActive = false;
    authState.currentSession = { data: { session: savedSession }, error: null };
    authState.storedSession = savedSession;
    vi.mocked(supabase.auth.refreshSession).mockClear();
  });

  afterEach(() => cleanup());

  it("keeps exactly one auth listener mounted under React StrictMode", async () => {
    renderDashboard();
    await screen.findByText("Dashboard");
    expect(authState.activeListeners).toBe(1);
  });

  it("does not refresh recursively on TOKEN_REFRESHED", async () => {
    renderDashboard();
    await screen.findByText("Dashboard");

    authState.callback?.("TOKEN_REFRESHED", savedSession);

    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("preserves the dashboard and avoids redirect loops for repeated 429 sign-out events", async () => {
    authState.cooldownActive = true;
    renderDashboard();
    await screen.findByText("Dashboard");

    authState.callback?.("SIGNED_OUT", null);
    authState.callback?.("SIGNED_OUT", null);

    await waitFor(() => expect(screen.getByText("Dashboard")).toBeTruthy());
    expect(screen.queryByText("Login")).toBeNull();
    expect(authState.activeListeners).toBe(1);
  });

  it("allows a genuinely revoked session to reach the login route", async () => {
    authState.currentSession = {
      data: { session: null },
      error: { message: "Refresh token is invalid", status: 400, code: "invalid_grant" },
    };
    authState.storedSession = null;

    renderDashboard();

    expect(await screen.findByText("Login")).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("keeps explicit logout functional", async () => {
    const { signOutCurrentSession } = await import("./supabase");
    const signOut = vi.mocked(signOutCurrentSession);
    renderDashboard();
    await screen.findByText("Dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });
});
