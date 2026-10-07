import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useMyApplication } from "@/lib/my-application";
import { Link, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Headphones,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MonitorCheck,
  ShieldCheck,
  UserRound,
  UsersRound,
  Wallet,
  X,
  ClipboardList,
} from "lucide-react";

import AssignmentsSection from "@/components/dashboard/AssignmentsSection";
import AssignmentDetailDialog from "@/components/dashboard/AssignmentDetailDialog";
import MyTasksSection from "@/components/dashboard/MyTasksSection";
import EarningsSection from "@/components/dashboard/EarningsSection";
import ProfileSection from "@/components/dashboard/ProfileSection";
import ReferEarnSection from "@/components/dashboard/ReferEarnSection";
import RequiredPolicyPrompt from "@/components/dashboard/RequiredPolicyPrompt";
import SupportSection from "@/components/dashboard/SupportSection";
import DeviceNotRecognizedModal from "@/components/dashboard/DeviceNotRecognizedModal";
import ApprovedDeviceInstructions from "@/components/dashboard/ApprovedDeviceInstructions";
import ApprovedDeviceSetup from "@/components/dashboard/ApprovedDeviceSetup";
import MessagesSection from "@/components/dashboard/MessagesSection";
import VendorChat from "@/components/dashboard/VendorChat";
import NotificationCenter from "@/components/NotificationCenter";
import { assignments, type Assignment } from "@/lib/assignments";
import { listContributorTasks, startContributorTask, type ContributorTask } from "@/lib/contributor-tasks";
import { getContributorReferrals } from "@/lib/referrals";
import { listNotifications } from "@/lib/notifications";
import type { ContributorReferralSummary } from "@shared/referrals";
import type { AppNotification } from "@shared/notifications";
import { useContributorEarnings } from "@/lib/earnings";
import { useDeviceRequest } from "@/lib/use-device-request";
import { getMyKycStatus, type KycStatus } from "@/lib/kyc";
import { useUnreadMessageCount } from "@/lib/notifications";
import type { PaymentRequest } from "@shared/payment-requests";

const sidebarItems: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Tasks", icon: ClipboardList },
  { label: "Messages", icon: MessageSquare },
  { label: "Earnings", icon: CircleDollarSign },
  { label: "Referrals", icon: UsersRound },
  { label: "Trusted Vendor", icon: ShieldCheck },
  { label: "Profile", icon: UserRound },
];

const contributorId = "CTR-162-717";
const availableAssignments = assignments.filter((a) => a.status === "Available").length;
const dashboardAssignments = assignments.filter((assignment) => assignment.status === "Available").slice(0, 3);

function DashboardLogo({ dark = false }: { dark?: boolean }) {
  return (
    <Link to="/" aria-label="Amazon Contributor Program home" className={`inline-flex shrink-0 flex-col leading-none ${dark ? "text-navy" : "text-white"}`}>
      <span className="text-[24px] font-bold tracking-[-1.4px]" style={{ fontFamily: "Arial, sans-serif" }}>
        amazon
      </span>
      <svg className="-mt-1 ml-1 h-[10px] w-[48px]" viewBox="0 0 56 13" fill="none" aria-hidden="true">
        <path d="M4 4.8c11.1 5.2 28.6 6.7 43.1-1.2" stroke="#FF9900" strokeWidth="2.1" strokeLinecap="round" />
        <path d="m42.2 2.7 5.8.1-2.6 4.5" stroke="#FF9900" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function SidebarContent({ activeItem, onSelect, onLogout, isSigningOut, unreadMessages = 0, unreadLoading = false }: { activeItem: string; onSelect: (label: string) => void; onLogout: () => void; isSigningOut: boolean; unreadMessages?: number; unreadLoading?: boolean }) {
  return (
    <>
      <div className="border-b border-slate-200 px-5 py-5">
        <DashboardLogo dark />
      </div>
      <nav className="px-3 py-4" aria-label="Dashboard navigation">
        <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
        <div className="space-y-1">
          {sidebarItems.map(({ label, icon: Icon }) => {
            const activeLabel = label === "Tasks" ? "My Tasks" : label === "Referrals" ? "Refer & Earn" : label;
            const isActive = activeItem === activeLabel;
            return (
              <button
                key={label}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(label)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-xs font-semibold transition ${isActive ? "bg-orange/10 text-orange" : "text-slate-500 hover:bg-slate-50 hover:text-navy"}`}
              >
                <Icon size={16} className="shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="min-w-0 flex-1">{label}</span>
                {label === "Messages" && unreadLoading && <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-slate-200" />}
                {label === "Messages" && !unreadLoading && unreadMessages > 0 && <span title={`${unreadMessages} unread messages`} aria-label={`${unreadMessages} unread messages`} role="img" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange text-[10px] font-extrabold text-navy">{unreadMessages}</span>}
                {isActive && <ChevronRight size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="mt-auto border-t border-slate-200 p-4">
        <div className="flex items-start gap-3 rounded-lg bg-[#f8f9fa] p-3">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-orange" />
          <div>
            <p className="text-[10px] font-extrabold text-navy">Secure workspace</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-500">Your account information is protected.</p>
          </div>
        </div>
        <button type="button" onClick={onLogout} disabled={isSigningOut} aria-busy={isSigningOut} className="mt-4 flex w-full items-center gap-3 border-t border-slate-200 px-3 pt-4 text-left text-xs font-semibold text-slate-500 transition hover:text-navy disabled:cursor-not-allowed disabled:opacity-60">
          <LogOut size={16} className="shrink-0" />
          <span>{isSigningOut ? "Signing out..." : "Logout"}</span>
        </button>
      </div>
    </>
  );
}

function TrustedVendorModal({ onClose }: { onClose: () => void }) {

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm" role="presentation">
      <div className="relative w-full max-w-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="trusted-vendor-title" aria-describedby="trusted-vendor-description">
        <div className="relative border-b border-slate-100 bg-[#fbfcfd] p-5 sm:p-6">
          <button type="button" onClick={onClose} aria-label="Close trusted vendor information" className="absolute right-4 top-4 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy"><X size={18} /></button>
          <div className="flex items-center gap-3 pr-8"><span className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy text-orange"><ShieldCheck size={22} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Trusted vendor support</p><h2 id="trusted-vendor-title" className="mt-1 text-xl font-extrabold tracking-[-0.03em] text-navy sm:text-2xl">Get an Authorized Work Device</h2></div></div>
        </div>
        <div className="p-5 sm:p-7">
          <p id="trusted-vendor-description" className="text-sm leading-6 text-slate-600">Contact a trusted vendor to obtain an authorized work device before participating in assignments.</p>
          <Link to="/trusted-vendor" onClick={onClose} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy shadow-[0_4px_14px_rgba(255,153,0,0.18)] transition hover:bg-orange-light"><Mail size={16} /> Contact Trusted Vendor</Link>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const [activeItem, setActiveItem] = useState("Dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileKycOpen, setProfileKycOpen] = useState(false);
  const [trustedVendorOpen, setTrustedVendorOpen] = useState(false);
  const [deviceNotRecognizedOpen, setDeviceNotRecognizedOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [isStartingTask, setIsStartingTask] = useState(false);
  const [taskStartError, setTaskStartError] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [chatRequest, setChatRequest] = useState<{ request: PaymentRequest; deviceName: string } | null>(null);
  const [deviceInstructionsOpen, setDeviceInstructionsOpen] = useState(false);
  const [dashboardTasks, setDashboardTasks] = useState<ContributorTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [activityError, setActivityError] = useState(false);
  const [dashboardReferrals, setDashboardReferrals] = useState<ContributorReferralSummary | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const { availableBalance, pendingEarnings, totalWithdrawn, paymentGatewayConfigured, isLoading: earningsLoading } = useContributorEarnings(session);
  const { request: deviceRequest, isLoading: deviceRequestLoading } = useDeviceRequest();
  const { count: unreadMessages, isLoading: unreadLoading } = useUnreadMessageCount("user");
  const { data: myApplication, isLoading: applicationLoading, isError: applicationError } = useMyApplication(session);
  // Accounts are issued after review, so an account without a linked application is treated as approved.
  const applicationStatus = applicationLoading ? "Loading…" : applicationError ? "Unavailable" : myApplication?.status ?? "Approved";
  const applicationTone = applicationStatus === "Approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : applicationStatus === "Rejected" ? "border-red-200 bg-red-50 text-red-700" : applicationStatus === "Under Review" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600";
  const applicationDot = applicationStatus === "Approved" ? "bg-emerald-500" : applicationStatus === "Rejected" ? "bg-red-500" : applicationStatus === "Under Review" ? "bg-amber-500" : "bg-slate-400";
  const isEligibleToStart = !applicationLoading && !applicationError && applicationStatus === "Approved";
  const contributorName = typeof session?.user.user_metadata?.full_name === "string" && session.user.user_metadata.full_name.trim()
    ? session.user.user_metadata.full_name.trim()
    : typeof session?.user.user_metadata?.name === "string" && session.user.user_metadata.name.trim()
      ? session.user.user_metadata.name.trim()
      : "Contributor";
  const interviewApproved = applicationStatus === "Approved";
  const deviceApproved = !deviceRequestLoading && deviceRequest?.status === "Approved";
  const kycVerified = kycStatus === "approved";
  useEffect(() => {
    if (!deviceApproved) {
      setKycStatus(null);
      return;
    }
    let active = true;
    const loadStatus = () => {
      void getMyKycStatus().then(({ status }) => {
        if (active) setKycStatus(status);
      }).catch(() => {
        if (active) setKycStatus(null);
      });
    };
    loadStatus();
    const interval = window.setInterval(loadStatus, 30_000);
    window.addEventListener("focus", loadStatus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", loadStatus);
    };
  }, [deviceApproved]);
  const deviceStatus = deviceRequestLoading
    ? "Loading…"
    : deviceRequest?.status === "Under Review"
      ? "Device Approval Pending"
      : deviceRequest?.status ?? "Device Not Recognized";
  const rewardTotal = dashboardReferrals?.history.reduce((total, referral) => total + (referral.reward ?? 0), 0) ?? 0;
  const recentActivity = [
    ...notifications
      .filter((notification) => ["application_approved", "device_approved", "balance_adjusted"].includes(notification.type))
      .map((notification) => ({ id: notification.id, title: notification.title, detail: notification.message, createdAt: notification.createdAt })),
    ...dashboardTasks.map((task) => ({
      id: task.id,
      title: task.status.toLowerCase().includes("complete") ? "Task completed" : "Task opened",
      detail: `${task.assignment.title} · ${task.status}`,
      createdAt: task.createdAt,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5);

  useEffect(() => {
    let active = true;
    void listContributorTasks().then(({ tasks }) => {
      if (active) setDashboardTasks(tasks);
    }).catch(() => {
      if (active) setActivityError(true);
    }).finally(() => {
      if (active) setTasksLoading(false);
    });
    void getContributorReferrals().then((result) => {
      if (active) setDashboardReferrals(result);
    }).catch(() => {});
    void listNotifications().then((result) => {
      if (active) setNotifications(result);
    }).catch(() => {
      if (active) setActivityError(true);
    });
    return () => { active = false; };
  }, []);

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  const selectNavItem = (label: string) => {
    setMobileNavOpen(false);
    if (label === "Trusted Vendor") {
      navigate("/trusted-vendor");
      return;
    }
    setActiveItem(label === "Tasks" ? "My Tasks" : label === "Referrals" ? "Refer & Earn" : label);
    if (label !== "Profile") setProfileKycOpen(false);
  };

  const openKycInProfile = () => {
    setActiveItem("Profile");
    setProfileKycOpen(true);
  };

  const handleStartSelectedAssignment = async () => {
    if (!selectedAssignment || isStartingTask || applicationLoading || deviceRequestLoading) return;
    setTaskStartError("");
    if (!isEligibleToStart) return;
    if (deviceRequest?.status !== "Approved") {
      setDeviceNotRecognizedOpen(true);
      return;
    }

    setIsStartingTask(true);
    try {
      const startedTask = await startContributorTask(selectedAssignment.id);
      setDashboardTasks((currentTasks) => [startedTask, ...currentTasks]);
      setSelectedAssignment(null);
      setActiveItem("My Tasks");
    } catch (startError) {
      setTaskStartError(startError instanceof Error ? startError.message : "Unable to start this assignment.");
    } finally {
      setIsStartingTask(false);
    }
  };

  useEffect(() => {
    if (!deviceNotRecognizedOpen && !trustedVendorOpen && !deviceInstructionsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDeviceNotRecognizedOpen(false);
      setTrustedVendorOpen(false);
      setDeviceInstructionsOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deviceNotRecognizedOpen, trustedVendorOpen, deviceInstructionsOpen]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f8f9fa] text-ink">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-navy text-white shadow-[0_4px_24px_rgba(9,22,35,0.18)]">
        <div className="flex h-[72px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="Open dashboard navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
              className="rounded-md p-2 text-white/80 transition hover:bg-white/10 hover:text-white lg:hidden"
            >
              <Menu size={22} />
            </button>
            <DashboardLogo />
            <span className="hidden h-6 border-l border-white/20 sm:block" />
            <span className="hidden text-xs font-semibold text-white/60 sm:block">Amazon Contributor Portal</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <NotificationCenter variant="user" />
            <div className="hidden h-7 border-l border-white/15 sm:block" />
            <button
              type="button"
              onClick={() => selectNavItem("Earnings")}
              className="hidden items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-white/10 sm:flex"
              aria-label={earningsLoading ? "Wallet balance loading" : `Wallet balance: $${availableBalance.toFixed(2)}`}
            >
              <Wallet size={16} className="shrink-0 text-orange" />
              <div className="leading-tight">
                {earningsLoading ? (
                  <span className="block h-4 w-16 animate-pulse rounded bg-white/20" aria-hidden="true" />
                ) : (
                  <p className="text-xs font-extrabold text-white">${availableBalance.toFixed(2)}</p>
                )}
                <p className="text-[9px] text-white/50">
                  {paymentGatewayConfigured ? "Payment configured" : "Setup payment gateway"}
                </p>
              </div>
            </button>
            <div className="hidden h-7 border-l border-white/15 sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange text-xs font-extrabold uppercase text-navy">{contributorName.slice(0, 2)}</span>
              <div className="hidden leading-tight sm:block">
                <p className="max-w-32 truncate text-xs font-bold text-white">{contributorName}</p>
                <p className="mt-1 text-[10px] text-white/50">Standard level</p>
              </div>
            </div>
            <div className="hidden h-7 border-l border-white/15 sm:block" />
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-72px)]">
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] w-[250px] shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <SidebarContent activeItem={activeItem} onSelect={selectNavItem} onLogout={() => void handleLogout()} isSigningOut={isSigningOut} unreadMessages={unreadMessages} unreadLoading={unreadLoading} />
        </aside>

        {mobileNavOpen && (
          <button type="button" aria-label="Close dashboard navigation" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-40 bg-navy/50 lg:hidden" />
        )}
        <aside className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-white shadow-2xl transition-transform duration-200 lg:hidden ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center justify-end border-b border-slate-200 px-3 py-2">
            <button type="button" aria-label="Close dashboard navigation" onClick={() => setMobileNavOpen(false)} className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy">
              <X size={20} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <SidebarContent activeItem={activeItem} onSelect={selectNavItem} onLogout={() => void handleLogout()} isSigningOut={isSigningOut} unreadMessages={unreadMessages} unreadLoading={unreadLoading} />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 sm:py-9 lg:px-10 lg:py-10">
            {activeItem === "Dashboard" && (
              <div className="space-y-6">
                <section className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Amazon Contributor Dashboard</p>
                    <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.04em] text-navy sm:text-[32px]">Welcome back, {contributorName}</h1>
                    <p className="mt-2 text-sm text-slate-500">Your contributor workspace at a glance.</p>
                  </div>
                  <div className="flex items-center gap-2 self-start rounded-full border px-3 py-2 text-xs font-bold sm:self-auto">
                    <span className={`h-2 w-2 rounded-full ${applicationDot}`} />
                    <span className={applicationTone.split(" ").slice(2).join(" ")}>{applicationStatus}</span>
                  </div>
                </section>

                {deviceApproved && (
                  <ApprovedDeviceSetup request={deviceRequest} onOpenInstructions={() => setDeviceInstructionsOpen(true)} />
                )}

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="progress-title">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Account progress</p>
                      <h2 id="progress-title" className="mt-1 text-sm font-extrabold text-navy">Your status</h2>
                    </div>
                    <ShieldCheck size={19} className="text-slate-300" />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      { title: "Interview Approved", status: applicationStatus, complete: interviewApproved },
                      ...(interviewApproved ? [{ title: "Device Approved", status: deviceStatus, complete: deviceApproved }] : []),
                      ...(deviceApproved ? [{ title: "KYC Verification", status: kycStatus === "approved" ? "Approved" : kycStatus === "pending" ? "Under Review" : kycStatus === "rejected" ? "Changes Requested" : "Not Submitted", complete: kycVerified }] : []),
                    ].map((step, index) => (
                      <div key={step.title} className="relative rounded-lg border border-slate-200 bg-[#fbfcfd] p-4">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Step {index + 1}</p>
                        <p className="mt-2 text-xs font-bold text-navy">{step.title}</p>
                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${step.complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{step.status}</span>
                      </div>
                    ))}
                  </div>
                </section>

                {deviceApproved && (
                  <section className={`flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 ${kycVerified ? "border-emerald-200 bg-emerald-50" : kycStatus === "pending" ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`} role="status">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${kycVerified ? "bg-emerald-500 text-white" : kycStatus === "pending" ? "bg-blue-500 text-white" : "bg-amber-500 text-white"}`}>{kycVerified ? <CheckCircle2 size={19} /> : kycStatus === "pending" ? <Clock3 size={19} /> : <AlertTriangle size={19} />}</span>
                      <div>
                        <h2 className={`text-sm font-extrabold ${kycVerified ? "text-emerald-800" : kycStatus === "pending" ? "text-blue-800" : "text-amber-800"}`}>{kycVerified ? "KYC Approved" : kycStatus === "pending" ? "KYC Under Review" : kycStatus === "rejected" ? "KYC Changes Requested" : "KYC Not Submitted"}</h2>
                        {!kycVerified && <p className="mt-1 max-w-[720px] text-xs leading-5 text-slate-600">{kycStatus === "pending" ? "Your identity submission is being reviewed. Your dashboard remains available." : kycStatus === "rejected" ? "Review the administrator’s reason and resubmit your identity documents." : "Complete KYC before adding withdrawal details."}</p>}
                      </div>
                    </div>
                    {!kycVerified && kycStatus !== "pending" && <button type="button" onClick={openKycInProfile} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-navy px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-[#1d3042]">{kycStatus === "rejected" ? "Resubmit KYC" : "Verify KYC"} <ArrowRight size={14} /></button>}
                  </section>
                )}

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Dashboard summary">
                  <button type="button" onClick={() => selectNavItem("Earnings")} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-orange/40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange/10 text-orange"><Wallet size={17} /></span>
                    <p className="mt-4 text-xs font-semibold text-slate-500">Earnings</p>
                    <p className="mt-1 text-xl font-extrabold tracking-tight text-navy">{earningsLoading ? "—" : `$${availableBalance.toFixed(2)}`}</p>
                  </button>
                  <button type="button" onClick={() => selectNavItem("Refer & Earn")} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-orange/40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange/10 text-orange"><UsersRound size={17} /></span>
                    <p className="mt-4 text-xs font-semibold text-slate-500">Refer &amp; Earn</p>
                    <p className="mt-1 text-xl font-extrabold tracking-tight text-navy">{dashboardReferrals ? dashboardReferrals.total : "—"}<span className="ml-1 text-xs font-semibold text-slate-400">referrals</span></p>
                  </button>
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><MonitorCheck size={17} /></span>
                    <p className="mt-4 text-xs font-semibold text-slate-500">Device Status</p>
                    <p className="mt-1 truncate text-sm font-extrabold text-navy">{deviceStatus}</p>
                  </div>
                  <button type="button" onClick={() => selectNavItem("Assignments")} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-orange/40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange/10 text-orange"><BriefcaseBusiness size={17} /></span>
                    <p className="mt-4 text-xs font-semibold text-slate-500">Available Tasks</p>
                    <p className="mt-1 text-xl font-extrabold tracking-tight text-navy">{availableAssignments}</p>
                  </button>
                  <button type="button" onClick={() => selectNavItem("Refer & Earn")} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-orange/40">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CircleDollarSign size={17} /></span>
                    <p className="mt-4 text-xs font-semibold text-slate-500">Rewards</p>
                    <p className="mt-1 text-xl font-extrabold tracking-tight text-navy">{dashboardReferrals ? `$${rewardTotal.toFixed(2)}` : "—"}</p>
                  </button>
                </section>

                <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
                  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="available-tasks-title">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><BriefcaseBusiness size={17} /></span><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Work opportunities</p><h2 id="available-tasks-title" className="mt-0.5 text-sm font-extrabold text-navy">Available Tasks</h2></div></div>
                      <button type="button" onClick={() => selectNavItem("Assignments")} className="inline-flex items-center gap-1 text-xs font-bold text-orange hover:text-navy">View all <ArrowRight size={14} /></button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {dashboardAssignments.map((assignment) => (
                        <button key={assignment.id} type="button" onClick={() => { setSelectedAssignment(assignment); setTaskStartError(""); }} className="flex w-full items-center justify-between gap-4 py-4 text-left transition hover:bg-slate-50">
                          <span className="min-w-0"><span className="block truncate text-xs font-extrabold text-navy">{assignment.title}</span><span className="mt-1 block text-[10px] text-slate-500">{assignment.category}</span></span>
                          <span className="shrink-0 text-right"><span className="block text-xs font-extrabold text-emerald-700">${assignment.reward.toFixed(2)}</span><span className="mt-1 block text-[10px] text-slate-400">{assignment.status}</span></span>
                        </button>
                      ))}
                      {dashboardAssignments.length === 0 && <p className="py-8 text-center text-xs text-slate-500">No tasks are available right now.</p>}
                    </div>
                  </section>

                  {!deviceApproved && (
                    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="recent-activity-title">
                      <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><Activity size={17} /></span><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Your account</p><h2 id="recent-activity-title" className="mt-0.5 text-sm font-extrabold text-navy">Recent Activity</h2></div></div>
                      {tasksLoading && notifications.length === 0 ? <p className="py-6 text-xs text-slate-400">Loading activity…</p> : recentActivity.length ? <ul className="mt-2 divide-y divide-slate-100">{recentActivity.map((activity) => <li key={activity.id} className="py-3"><p className="text-xs font-bold text-navy">{activity.title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{activity.detail}</p><time className="mt-1 block text-[10px] text-slate-400" dateTime={activity.createdAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(activity.createdAt))}</time></li>)}</ul> : <p className="py-6 text-xs text-slate-500">{activityError ? "Unable to load recent activity." : "No recent contributor activity."}</p>}
                    </section>
                  )}
                </div>

                {deviceApproved && (
                  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="recent-activity-title">
                    <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><Activity size={17} /></span><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Your account</p><h2 id="recent-activity-title" className="mt-0.5 text-sm font-extrabold text-navy">Recent Activity</h2></div></div>
                    {tasksLoading && notifications.length === 0 ? <p className="py-6 text-xs text-slate-400">Loading activity…</p> : recentActivity.length ? <ul className="mt-2 grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2">{recentActivity.map((activity) => <li key={activity.id} className="py-3"><p className="text-xs font-bold text-navy">{activity.title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{activity.detail}</p><time className="mt-1 block text-[10px] text-slate-400" dateTime={activity.createdAt}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(activity.createdAt))}</time></li>)}</ul> : <p className="py-6 text-xs text-slate-500">{activityError ? "Unable to load recent activity." : "No recent contributor activity."}</p>}
                  </section>
                )}
              </div>
            )}
            {activeItem === "Assignments" && (
              <AssignmentsSection
                onSelectAssignment={(assignment) => { setSelectedAssignment(assignment); setTaskStartError(""); }}
              />
            )}
            {activeItem === "My Tasks" && <MyTasksSection />}
            {activeItem === "Earnings" && <EarningsSection contributorId={contributorId} session={session} deviceVerified={deviceRequest?.status === "Approved"} kycVerified={kycVerified} onContactVendor={() => setTrustedVendorOpen(true)} onVerifyKyc={openKycInProfile} />}
            {activeItem === "Refer & Earn" && <ReferEarnSection />}
            {activeItem === "Profile" && <ProfileSection session={session} applicationStatus={applicationStatus} deviceStatus={deviceRequestLoading ? "Loading…" : deviceRequest?.status === "Approved" ? "Approved" : deviceRequest?.status ?? "Not Recognized"} paymentConfigured={paymentGatewayConfigured} isLoading={applicationLoading || deviceRequestLoading || earningsLoading} userId={session?.user.id ?? ""} deviceApproved={deviceApproved} kycOpen={profileKycOpen} onOpenKyc={openKycInProfile} onCloseKyc={() => setProfileKycOpen(false)} onOpenEarnings={() => selectNavItem("Earnings")} />}
            {activeItem === "Messages" && <MessagesSection />}
            {activeItem === "Support" && <SupportSection onOpenMessages={() => setActiveItem("Messages")} />}

            <div className="mt-8 flex flex-col justify-between gap-3 border-t border-slate-200 pt-5 text-[10px] text-slate-400 sm:flex-row sm:items-center">
              <p>Amazon Contributor Portal · Secure access for approved contributors</p>
              <div className="flex items-center gap-4"><Link to="/legal/privacy" className="transition hover:text-navy">Privacy</Link><Link to="/legal/terms" className="transition hover:text-navy">Terms</Link><button type="button" onClick={() => selectNavItem("Support")} className="flex items-center gap-1 transition hover:text-navy"><Headphones size={12} /> Support</button></div>
            </div>
          </div>
        </main>
      </div>
      <RequiredPolicyPrompt />
      {selectedAssignment && <AssignmentDetailDialog assignment={selectedAssignment} isEligible={isEligibleToStart} eligibilityLoading={applicationLoading} deviceLoading={deviceRequestLoading} isStarting={isStartingTask} startError={taskStartError} onClose={() => setSelectedAssignment(null)} onStart={() => void handleStartSelectedAssignment()} />}
      {deviceNotRecognizedOpen && <DeviceNotRecognizedModal onClose={() => setDeviceNotRecognizedOpen(false)} onVerifyDevice={() => { setDeviceNotRecognizedOpen(false); setSelectedAssignment(null); navigate("/trusted-vendor"); }} />}
      {trustedVendorOpen && <TrustedVendorModal onClose={() => setTrustedVendorOpen(false)} />}
      {deviceInstructionsOpen && deviceRequest?.status === "Approved" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeviceInstructionsOpen(false); }}>
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="device-instructions-title">
            <button type="button" onClick={() => setDeviceInstructionsOpen(false)} aria-label="Close device instructions" className="absolute right-4 top-4 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy"><X size={18} /></button>
            <h2 id="device-instructions-title" className="pr-10 text-xl font-extrabold text-navy">Device Setup Instructions</h2>
            <ApprovedDeviceInstructions deviceName={deviceRequest.deviceName} onMessageVendor={() => { setDeviceInstructionsOpen(false); setChatRequest({ request: deviceRequest, deviceName: deviceRequest.deviceName }); }} />
          </div>
        </div>
      )}
      {chatRequest && (
        <VendorChat
          paymentRequest={chatRequest.request}
          deviceName={chatRequest.deviceName}
          onClose={() => setChatRequest(null)}
        />
      )}
    </div>
  );
}
