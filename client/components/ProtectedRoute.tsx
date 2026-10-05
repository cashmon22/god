import { useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/api-request";

export default function ProtectedRoute({ allowPending = false }: { allowPending?: boolean }) {
  const { session, isLoading, authError, retrySession } = useAuth();
  const location = useLocation();
  const access = useQuery({
    queryKey: ["interview-access", session?.user.id],
    queryFn: () => apiRequest<{ status: "Under Review" | "Approved" | "Rejected" | null; isAdmin?: boolean }>("/api/interview/access"),
    enabled: Boolean(session && !allowPending && session.user.app_metadata?.role !== "admin"),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-navy" role="status" aria-live="polite"><div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm font-semibold shadow-card"><LoaderCircle size={18} className="animate-spin text-orange" />Checking your secure session...</div></div>;
  }

  if (authError) return <main className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-5"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-7 text-center shadow-card"><h1 className="text-lg font-extrabold text-navy">Unable to verify your saved session</h1><p className="mt-2 text-sm leading-6 text-slate-500">Your saved sign-in was not cleared. Retry the secure session check or sign in again.</p><div className="mt-5 flex justify-center gap-3"><button type="button" onClick={() => void retrySession()} className="rounded-md bg-orange px-4 py-2 text-xs font-bold text-navy">Retry</button><Link to="/login" state={{ from: location.pathname }} className="rounded-md border border-slate-200 px-4 py-2 text-xs font-bold text-navy">Sign in</Link></div></div></main>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (allowPending || session.user.app_metadata?.role === "admin") return <Outlet />;
  if (access.isLoading) return <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-sm font-semibold text-navy" role="status"><LoaderCircle size={18} className="mr-2 animate-spin text-orange" />Verifying interview approval…</div>;
  if (access.isError) return <main className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-5"><div className="max-w-md rounded-xl border border-slate-200 bg-white p-7 text-center shadow-card"><h1 className="text-lg font-extrabold text-navy">Unable to verify access</h1><p className="mt-2 text-sm leading-6 text-slate-500">Please try again in a moment.</p><button type="button" onClick={() => void access.refetch()} className="mt-5 rounded-md bg-orange px-4 py-2 text-xs font-bold text-navy">Try again</button></div></main>;
  if (access.data?.status !== "Approved") return <Navigate to="/interview" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
