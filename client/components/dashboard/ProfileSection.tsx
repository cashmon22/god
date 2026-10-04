import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { openCookiePreferences } from "@/components/CookiePrivacyControls";
import KycSection from "@/components/dashboard/KycSection";
import type { Session } from "@supabase/supabase-js";
import { BadgeCheck, Bell, CalendarDays, CheckCircle2, KeyRound, Mail, MonitorCheck, Save, ShieldCheck, UserRound } from "lucide-react";
import { showInAppNotifications } from "@/lib/account-preferences";
import { supabase } from "@/lib/supabase";

interface ProfileSectionProps {
  session: Session | null;
  applicationStatus: string;
  deviceStatus: string;
  paymentConfigured: boolean;
  isLoading: boolean;
  userId: string;
  deviceApproved: boolean;
  kycOpen: boolean;
  onOpenKyc: () => void;
  onCloseKyc: () => void;
  onOpenEarnings: () => void;
}

function savedFullName(session: Session | null) {
  const value = session?.user.user_metadata?.full_name;
  return typeof value === "string" ? value.trim() : "";
}

function savedPreferences(session: Session | null) {
  const value = session?.user.user_metadata?.contributor_preferences;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default function ProfileSection({ session, applicationStatus, deviceStatus, paymentConfigured, isLoading, userId, deviceApproved, kycOpen, onOpenKyc, onCloseKyc, onOpenEarnings }: ProfileSectionProps) {
  const [fullName, setFullName] = useState(() => savedFullName(session));
  const [savedName, setSavedName] = useState(() => savedFullName(session));
  const [showNotifications, setShowNotifications] = useState(() => showInAppNotifications(session?.user.user_metadata));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [sessionActionError, setSessionActionError] = useState("");
  const [sessionActionMessage, setSessionActionMessage] = useState("");
  const [isSigningOutOthers, setIsSigningOutOthers] = useState(false);
  const email = session?.user.email ?? "";
  const memberSince = session?.user.created_at
    ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(session.user.created_at))
    : "";

  useEffect(() => {
    setFullName(savedFullName(session));
    setSavedName(savedFullName(session));
    setShowNotifications(showInAppNotifications(session?.user.user_metadata));
  }, [session?.user.id, session?.user.user_metadata]);

  const completedFields = Number(Boolean(email)) + Number(Boolean(savedName));
  const missingFields = [!email ? "Email address" : "", !savedName ? "Full name" : ""].filter(Boolean);

  const handleSave = async () => {
    if (!session || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    setSavedMessage("");
    const preferences = savedPreferences(session);
    const { data, error } = await supabase.auth.updateUser({
      data: {
        ...session.user.user_metadata,
        full_name: fullName.trim(),
        contributor_preferences: {
          ...preferences,
          showInAppNotifications: showNotifications,
        },
      },
    });
    if (error) {
      setSaveError("Unable to save your profile changes. Please try again.");
    } else {
      const persistedName = typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name.trim() : "";
      const persistedPreference = showInAppNotifications(data.user.user_metadata);
      setFullName(persistedName);
      setSavedName(persistedName);
      setShowNotifications(persistedPreference);
      setSavedMessage("Your profile and preferences have been saved.");
    }
    setIsSaving(false);
  };

  const handlePasswordChange = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || isChangingPassword) return;
    setPasswordError("");
    setPasswordMessage("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Enter your current password and both new-password fields.");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("Use at least 12 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Choose a new password that differs from your current password.");
      return;
    }
    setIsChangingPassword(true);
    try {
      const { error: verificationError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (verificationError) {
        setPasswordError("Your current password could not be verified.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordError(error.message || "Unable to update your password. Please try again.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Your password has been changed.");
    } catch {
      setPasswordError("Unable to update your password. Please try again.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSignOutOtherSessions = async () => {
    if (isSigningOutOthers) return;
    setSessionActionError("");
    setSessionActionMessage("");
    setIsSigningOutOthers(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) {
        setSessionActionError("Unable to sign out other sessions. Please try again.");
        return;
      }
      setSessionActionMessage("All other active sessions have been signed out. This session remains active.");
    } catch {
      setSessionActionError("Unable to sign out other sessions. Please try again.");
    } finally {
      setIsSigningOutOthers(false);
    }
  };

  if (kycOpen) return <div><button type="button" onClick={onCloseKyc} className="mb-5 inline-flex items-center rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:border-navy hover:text-navy">Back to profile</button><KycSection userId={userId} deviceApproved={deviceApproved} /></div>;

  return (
    <div>
      <div className="border-b border-slate-200 pb-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Contributor workspace</p>
        <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.04em] text-navy sm:text-[32px]">Profile</h1>
        <p className="mt-2 max-w-[600px] text-sm leading-6 text-slate-500">Keep your account details up to date and manage your contributor preferences.</p>
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="profile-completion-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Profile completion</p><h2 id="profile-completion-title" className="mt-1 text-sm font-extrabold text-navy">{completedFields} of 2 important details complete</h2></div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-extrabold ${missingFields.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}><CheckCircle2 size={13} />{missingFields.length ? `${missingFields.length} item${missingFields.length === 1 ? "" : "s"} to complete` : "Profile complete"}</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={2} aria-valuenow={completedFields}><div className="h-full rounded-full bg-orange transition-all" style={{ width: `${completedFields * 50}%` }} /></div>
        {missingFields.length > 0 && <p className="mt-3 text-xs text-slate-500">Still needed: <span className="font-bold text-navy">{missingFields.join(", ")}</span></p>}
      </section>

      <nav className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Profile sections">
        <a href="#profile-personal-information" className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Personal Information</span><span className="mt-1 block text-[11px] text-slate-500">Name and contact details</span></a>
        <a href="#profile-account-status" className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Account Status</span><span className="mt-1 block text-[11px] text-slate-500">Account, device, and payment status</span></a>
        <a href="#profile-security" className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Password &amp; Security</span><span className="mt-1 block text-[11px] text-slate-500">Change your password</span></a>
        <a href="#profile-active-sessions" className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Active Sessions</span><span className="mt-1 block text-[11px] text-slate-500">Review current access</span></a>
        <button type="button" onClick={onOpenKyc} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">KYC Verification</span><span className="mt-1 block text-[11px] text-slate-500">Review your identity status</span></button>
        <button type="button" onClick={onOpenEarnings} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Withdrawal Details</span><span className="mt-1 block text-[11px] text-slate-500">Payment setup and withdrawals</span></button>
        <Link to="/trusted-vendor" className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-orange/50"><span className="text-xs font-extrabold text-navy">Security / Device Verification</span><span className="mt-1 block text-[11px] text-slate-500">Current device: {deviceStatus}</span></Link>
      </nav>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section id="profile-personal-information" className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="account-details-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><UserRound size={17} /></span><h2 id="account-details-title" className="text-sm font-extrabold text-navy">Account Details</h2></div>
          <div className="mt-5 space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-navy">Full name</span><input type="text" autoComplete="name" maxLength={120} value={fullName} onChange={(event) => { setFullName(event.target.value); setSavedMessage(""); }} className="h-11 w-full rounded-lg border border-slate-200 bg-[#fbfcfd] px-3 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10" placeholder="Add your full name" /></label>
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-[#fbfcfd] px-3 py-3"><Mail size={16} className="shrink-0 text-slate-400" /><div className="min-w-0"><p className="text-[10px] font-semibold text-slate-400">Email address</p><p className="mt-0.5 truncate text-xs font-bold text-navy">{email || "Not available"}</p></div></div>
            {memberSince && <div className="flex items-center gap-3"><CalendarDays size={16} className="shrink-0 text-slate-400" /><div><p className="text-[10px] font-semibold text-slate-400">Member since</p><p className="mt-0.5 text-xs font-bold text-navy">{memberSince}</p></div></div>}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="account-preferences-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><Bell size={17} /></span><h2 id="account-preferences-title" className="text-sm font-extrabold text-navy">Account Preferences</h2></div>
          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-orange/40"><input type="checkbox" checked={showNotifications} onChange={(event) => { setShowNotifications(event.target.checked); setSavedMessage(""); }} className="mt-0.5 h-4 w-4 accent-orange" /><span><span className="block text-xs font-bold text-navy">Show in-app notifications</span><span className="mt-1 block text-xs leading-5 text-slate-500">Display account alerts in the notification center. Turning this off hides the center without deleting notifications.</span></span></label>
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#fbfcfd] p-3 text-xs text-slate-500"><ShieldCheck size={15} className="shrink-0 text-orange" />Email and message delivery settings are not available for this account.</div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6 lg:col-span-2" aria-labelledby="legal-settings-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><ShieldCheck size={17} /></span><h2 id="legal-settings-title" className="text-sm font-extrabold text-navy">Legal &amp; Privacy</h2></div>
          <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-navy"><Link className="hover:text-orange" to="/legal/terms">Terms of Service</Link><Link className="hover:text-orange" to="/legal/privacy">Privacy Policy</Link><Link className="hover:text-orange" to="/legal/cookies">Cookie Policy</Link><Link className="hover:text-orange" to="/legal/contributor-agreement">Contributor Agreement</Link></div><button type="button" onClick={openCookiePreferences} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-navy hover:border-orange">Manage cookie preferences</button></div>
        </section>

        {!isLoading && <section id="profile-account-status" className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6 lg:col-span-2" aria-labelledby="account-status-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><BadgeCheck size={17} /></span><h2 id="account-status-title" className="text-sm font-extrabold text-navy">Account Status</h2></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="flex items-center justify-between rounded-lg border border-slate-200 bg-[#fbfcfd] px-4 py-3"><span className="text-xs font-bold text-slate-500">Account</span><span className="text-xs font-extrabold text-navy">{applicationStatus}</span></div><div className="flex items-center justify-between rounded-lg border border-slate-200 bg-[#fbfcfd] px-4 py-3"><span className="text-xs font-bold text-slate-500">Device</span><span className="text-xs font-extrabold text-navy">{deviceStatus}</span></div><div className="flex items-center justify-between rounded-lg border border-slate-200 bg-[#fbfcfd] px-4 py-3"><span className="text-xs font-bold text-slate-500">Payment gateway</span><span className="text-xs font-extrabold text-navy">{paymentConfigured ? "Configured" : "Not configured"}</span></div></div>
        </section>}

        <section id="profile-security" className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="password-security-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><KeyRound size={17} /></span><h2 id="password-security-title" className="text-sm font-extrabold text-navy">Password &amp; Security</h2></div>
          <form className="mt-5 space-y-4" onSubmit={handlePasswordChange}>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-navy">Current password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordError(""); setPasswordMessage(""); }} className="h-11 w-full rounded-lg border border-slate-200 bg-[#fbfcfd] px-3 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-navy">New password</span><input type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordError(""); setPasswordMessage(""); }} className="h-11 w-full rounded-lg border border-slate-200 bg-[#fbfcfd] px-3 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold text-navy">Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} required value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(""); setPasswordMessage(""); }} className="h-11 w-full rounded-lg border border-slate-200 bg-[#fbfcfd] px-3 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10" /></label>
            <p className="text-xs leading-5 text-slate-500">Use at least 12 characters. Your current password is verified before the update.</p>
            {(passwordError || passwordMessage) && <p className={`rounded-lg border p-3 text-xs ${passwordError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={passwordError ? "alert" : "status"}>{passwordError || passwordMessage}</p>}
            <button type="submit" disabled={isChangingPassword || !session} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-navy px-4 text-xs font-extrabold text-white transition hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-60">{isChangingPassword ? "Updating…" : "Change Password"}</button>
          </form>
        </section>

        <section id="profile-active-sessions" className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="active-sessions-title">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange/10 text-orange"><MonitorCheck size={17} /></span><h2 id="active-sessions-title" className="text-sm font-extrabold text-navy">Active Sessions / Devices</h2></div>
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><p className="flex items-center gap-2 text-xs font-extrabold text-emerald-800"><span className="h-2 w-2 rounded-full bg-emerald-500" />Current session is active</p><p className="mt-2 text-xs leading-5 text-emerald-800">You are signed in on this browser.</p></div>
          <p className="mt-4 text-xs leading-5 text-slate-500">Supabase Auth does not provide this app with a reliable list or count of other signed-in devices, so their browser details and last activity are unavailable.</p>
          {(sessionActionError || sessionActionMessage) && <p className={`mt-4 rounded-lg border p-3 text-xs ${sessionActionError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={sessionActionError ? "alert" : "status"}>{sessionActionError || sessionActionMessage}</p>}
          <button type="button" onClick={() => void handleSignOutOtherSessions()} disabled={isSigningOutOthers || !session} className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 px-4 text-xs font-extrabold text-navy transition hover:border-orange disabled:cursor-not-allowed disabled:opacity-60">{isSigningOutOthers ? "Signing out other sessions…" : "Sign out of all other devices"}</button>
        </section>

        {(saveError || savedMessage) && <div className={`rounded-lg border p-3 text-sm lg:col-span-2 ${saveError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={saveError ? "alert" : "status"}>{saveError || savedMessage}</div>}
        <div className="flex justify-end lg:col-span-2"><button type="button" onClick={() => void handleSave()} disabled={isSaving || !session} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-navy px-5 text-xs font-extrabold text-white transition hover:bg-navy/90 disabled:cursor-not-allowed disabled:opacity-60"><Save size={15} />{isSaving ? "Saving…" : "Save Changes"}</button></div>
      </div>
    </div>
  );
}
