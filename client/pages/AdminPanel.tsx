import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  BriefcaseBusiness,
  ChevronRight,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Search,
  Settings,
  SearchCheck,
  Mail,
  ShieldCheck,
  Scale,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { SkeletonStatCard } from "@/components/skeletons";
import { ADMIN_REVIEW_COUNTS_CHANGED_EVENT, getAdminDashboardStats, getAdminReviewCounts, type AdminReviewCounts } from "@/lib/admin-dashboard";
import NotificationCenter from "@/components/NotificationCenter";
import { PageTransition } from "@/components/PageTransition";
import { useUnreadMessageCount } from "@/lib/notifications";

type ReviewCountKey = keyof AdminReviewCounts;

const navigation: Array<{ label: string; href: string; icon: typeof LayoutDashboard; end?: boolean; countKey?: ReviewCountKey }> = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, end: true },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Applications", href: "/admin/applications", icon: BriefcaseBusiness, countKey: "pendingApplications" },
  { label: "Interview Management", href: "/admin/interviews", icon: ClipboardList, countKey: "pendingInterviews" },
  { label: "Device Requests", href: "/admin/device-requests", icon: ClipboardList, countKey: "pendingDeviceRequests" },
  { label: "KYC Verification", href: "/admin/kyc", icon: ShieldCheck, countKey: "pendingKyc" },
  { label: "Product Research", href: "/admin/research-tasks", icon: ClipboardList },
  { label: "Messages", href: "/admin/messages", icon: MessageSquare },
  { label: "Devices", href: "/admin/devices", icon: Monitor },
  { label: "SEO Center", href: "/admin/seo", icon: SearchCheck },
  { label: "Email Management", href: "/admin/email-management", icon: Mail },
  { label: "Legal & Compliance", href: "/admin/legal-management", icon: Scale },
  { label: "Site Settings", href: "/admin/site-settings", icon: Settings },
];

const sectionDetails: Record<string, { eyebrow: string; title: string; description: string }> = {
  users: {
    eyebrow: "People",
    title: "Users",
    description: "Manage contributors and review account activity from one place.",
  },
  applications: {
    eyebrow: "Onboarding",
    title: "Applications",
    description: "Review and organize incoming contributor applications.",
  },
  "device-requests": {
    eyebrow: "Operations",
    title: "Device Requests",
    description: "Keep track of device authorization requests and their status.",
  },
  messages: {
    eyebrow: "Communications",
    title: "Messages",
    description: "Manage support and vendor conversations with contributors.",
  },
  devices: {
    eyebrow: "Inventory",
    title: "Devices",
    description: "Monitor authorized devices across the contributor network.",
  },
};

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AD";
}

export default function AdminPanel() {
  const { session, isLoading, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [reviewCounts, setReviewCounts] = useState<AdminReviewCounts | null>(null);
  const { count: unreadMessages } = useUnreadMessageCount("admin");

  useEffect(() => {
    if (!session || session.user.app_metadata?.role !== "admin") return;
    let active = true;
    const refreshCounts = () => {
      void getAdminReviewCounts().then((counts) => {
        if (active) setReviewCounts(counts);
      }).catch(() => {});
    };
    refreshCounts();
    const interval = window.setInterval(refreshCounts, 30_000);
    window.addEventListener(ADMIN_REVIEW_COUNTS_CHANGED_EVENT, refreshCounts);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(ADMIN_REVIEW_COUNTS_CHANGED_EVENT, refreshCounts);
    };
  }, [session]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-sm font-semibold text-navy dark:text-slate-100">Checking your secure session...</div>;
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const isAdmin = session.user.app_metadata?.role === "admin";
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const displayName = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Administrator";
  const initials = initialsFor(displayName);

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError("");
    try {
      const { error } = await signOut();
      if (error) {
        setSignOutError("Unable to sign out. Your session is still active; please try again.");
        return;
      }
      navigate("/login", { replace: true });
    } catch {
      setSignOutError("Unable to sign out. Your session is still active; please try again.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-ink">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col bg-navy text-white transition-transform duration-200 lg:translate-x-0 ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-[76px] items-center justify-between border-b border-white/10 px-6">
          <Link to="/admin" className="flex items-center gap-3" onClick={() => setMobileNavOpen(false)}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange text-navy dark:text-slate-100"><ShieldCheck size={20} strokeWidth={2.4} /></span>
            <span><span className="block text-sm font-extrabold tracking-tight">Admin Portal</span><span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Contributor program</span></span>
          </Link>
          <button type="button" className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <div className="px-4 py-7">
          <p className="px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Workspace</p>
          <nav className="mt-3 space-y-1" aria-label="Admin navigation">
            {navigation.map(({ label, href, icon: Icon, end, countKey }) => (
              <NavLink key={label} to={href} end={end} onClick={() => setMobileNavOpen(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition ${isActive ? "bg-orange text-navy dark:text-slate-100 shadow-[0_6px_18px_rgba(255,153,0,0.18)]" : "text-white/65 hover:bg-white/[0.07] hover:text-white"}`}>
                {({ isActive }) => {
                  const count = countKey ? reviewCounts?.[countKey] ?? 0 : label === "Messages" ? unreadMessages : 0;
                  return <><Icon size={18} strokeWidth={1.9} /><span className="min-w-0 flex-1 truncate">{label}</span>
                    {count > 0 && <span aria-label={`${count} ${label === "Messages" ? "unread messages" : "pending items"}`} className={`flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold ${isActive ? "bg-navy text-white" : "bg-orange text-navy"}`}>{count > 99 ? "99+" : count}</span>}
                    <ChevronRight size={15} className="ml-auto shrink-0 opacity-0 transition group-[.bg-orange]:opacity-60" /></>;
                }}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-lg bg-white/[0.06] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange/15 text-xs font-extrabold text-orange">{initials}</span>
            <div className="min-w-0"><p className="truncate text-xs font-bold text-white">{displayName}</p><p className="truncate text-[10px] text-white/45">{session.user.email}</p></div>
          </div>
          <button type="button" onClick={handleLogout} disabled={isSigningOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-semibold text-white/55 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50"><LogOut size={16} /> {isSigningOut ? "Signing out..." : "Sign out"}</button>
        </div>
      </aside>

      {mobileNavOpen && <button type="button" className="fixed inset-0 z-30 bg-navy/50 lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />}

      <div className="min-h-screen lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/95 px-4 backdrop-blur sm:px-7 lg:px-10">
          <div className="flex items-center gap-3"><button type="button" className="rounded-lg border border-slate-200 p-2 text-navy dark:text-slate-100 lg:hidden" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div><p className="hidden text-[10px] font-bold uppercase tracking-[0.18em] text-orange sm:block">Administrator workspace</p><h1 className="text-lg font-extrabold text-navy dark:text-slate-100 sm:mt-0.5 sm:text-xl">{location.pathname === "/admin" ? "Dashboard" : navigation.find((item) => item.href === location.pathname)?.label || "Admin Portal"}</h1></div></div>
          <div className="flex items-center gap-2 sm:gap-4"><button type="button" className="hidden rounded-lg border border-slate-200 p-2.5 text-slate-400 transition hover:border-orange/40 hover:text-orange sm:block" aria-label="Search"><Search size={17} /></button><NotificationCenter variant="admin" /><span className="hidden h-7 w-px bg-slate-200 sm:block" /><button type="button" onClick={handleLogout} disabled={isSigningOut} className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-navy transition hover:border-orange/40 hover:text-orange disabled:opacity-50 sm:flex dark:border-slate-700 dark:text-slate-100"><LogOut size={15} /> {isSigningOut ? "Signing out..." : "Sign out"}</button><span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-xs font-extrabold text-white">{initials}</span></div>
        </header>
        {signOutError && <p className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mx-7 lg:mx-10" role="alert">{signOutError}</p>}
        <main className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10 lg:py-11">
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">{eyebrow}</p><h2 className="mt-2 text-[32px] font-extrabold tracking-[-0.04em] text-navy dark:text-slate-100 sm:text-[40px]">{title}</h2><p className="mt-3 max-w-[580px] text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p></div>{action}</div>;
}

function PlaceholderPage({ section }: { section: keyof typeof sectionDetails }) {
  const details = sectionDetails[section];
  return <><PageHeading {...details} action={<button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange px-4 py-3 text-xs font-extrabold text-navy dark:text-slate-100 shadow-[0_6px_18px_rgba(255,153,0,0.16)] transition hover:bg-orange-light"><Activity size={15} /> Coming soon</button>} /><div className="mt-8 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 p-8 text-center shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-14"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange/10 text-orange"><Settings size={24} /></div><h3 className="mt-5 text-base font-extrabold text-navy dark:text-slate-100">{details.title} workspace</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">This section is ready for data and workflows. Records will appear here once the admin tools are connected.</p></div></>;
}

export function AdminDashboard() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getAdminDashboardStats>> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    void getAdminDashboardStats().then((data) => {
      if (isMounted) setStats(data);
    }).catch((loadError) => {
      if (isMounted) setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard analytics.");
    }).finally(() => {
      if (isMounted) setIsLoading(false);
    });
    return () => { isMounted = false; };
  }, []);

  const metrics = [
    { label: "Contributors", value: stats?.users, icon: Users },
    { label: "Applications", value: stats?.applications, icon: BriefcaseBusiness },
    { label: "Applications in review", value: stats?.pendingApplications, icon: Activity },
    { label: "Device requests", value: stats?.deviceRequests, icon: ClipboardList },
    { label: "Device requests pending", value: stats?.pendingDeviceRequests, icon: Monitor },
    { label: "Active conversations", value: stats?.activeConversations, icon: MessageSquare },
    { label: "Available devices", value: stats?.availableDevices, icon: Monitor },
    { label: "Available balance", value: stats ? `$${stats.availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined, icon: Activity },
    { label: "Pending earnings", value: stats ? `$${stats.pendingEarnings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined, icon: Activity },
  ];

  return <>
    <PageHeading eyebrow="Command center" title="Dashboard" description="A clear view of contributor activity and operational priorities." />
    {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>}
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Admin analytics">
      {isLoading ? Array.from({ length: metrics.length }).map((_, index) => <SkeletonStatCard key={index} />) : metrics.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_3px_16px_rgba(20,36,52,0.04)] dark:border-slate-700 dark:bg-slate-900"><div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange/10 text-orange"><Icon size={19} /></span><span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Database</span></div><p className="mt-6 text-3xl font-extrabold tracking-tight text-navy dark:text-slate-100">{value ?? "—"}</p><p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p></div>)}
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-7 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-extrabold text-navy dark:text-slate-100">Review queue</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Items requiring administrator attention.</p></div><Activity size={19} className="text-orange" /></div>
        <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          <div className="flex items-center justify-between px-4 py-3 text-sm"><span className="text-slate-600 dark:text-slate-400">Applications awaiting review</span><strong className="text-navy dark:text-slate-100">{isLoading ? "—" : stats?.pendingApplications ?? 0}</strong></div>
          <Link to="/admin/interviews?status=Under%20Review" aria-label={`Review ${stats?.pendingInterviews ?? 0} pending interviews`} className="flex items-center justify-between bg-orange/[0.06] px-4 py-3 text-sm transition hover:bg-orange/10"><span className="font-bold text-navy dark:text-slate-100">Pending Interviews</span><strong className="rounded-full bg-orange px-3 py-1 text-sm font-extrabold text-navy">{isLoading ? "—" : stats?.pendingInterviews ?? 0}</strong></Link>
          <div className="flex items-center justify-between px-4 py-3 text-sm"><span className="text-slate-600 dark:text-slate-400">Device requests awaiting review</span><strong className="text-navy dark:text-slate-100">{isLoading ? "—" : stats?.pendingDeviceRequests ?? 0}</strong></div>
        </div>
      </div>
      <div className="rounded-xl bg-navy p-6 text-white shadow-[0_3px_16px_rgba(20,36,52,0.08)] sm:p-7"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">Contributor earnings</p><h3 className="mt-2 text-lg font-extrabold">Platform totals</h3></div><BriefcaseBusiness size={20} className="text-orange" /></div><div className="mt-5 grid grid-cols-2 gap-4"><div className="rounded-lg bg-white/[0.07] p-4"><p className="text-xs text-white/55">Available balance</p><p className="mt-2 text-xl font-extrabold">{isLoading || !stats ? "—" : `$${stats.availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p></div><div className="rounded-lg bg-white/[0.07] p-4"><p className="text-xs text-white/55">Pending earnings</p><p className="mt-2 text-xl font-extrabold">{isLoading || !stats ? "—" : `$${stats.pendingEarnings.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</p></div></div></div>
    </div>
  </>;
}

export function AdminPlaceholder({ section }: { section: keyof typeof sectionDetails }) {
  return <PlaceholderPage section={section} />;
}
