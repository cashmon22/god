import "./global.css";

import { useEffect } from "react";
import { ShieldCheck, Wrench } from "lucide-react";
import { PublicSiteSettingsProvider, usePublicSiteSettings, useSiteSettingsLoaded } from "@/lib/site-settings";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { PageTransition } from "@/components/PageTransition";
import Index from "./pages/Index";
import HowItWorks from "./pages/HowItWorks";
import Payments from "./pages/Payments";
import SuccessStories from "./pages/SuccessStories";
import FAQ from "./pages/FAQ";
import Contact from "./pages/Contact";
import Apply from "./pages/Apply";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import TrustedVendor from "./pages/TrustedVendor";
import PaymentRequest from "./pages/PaymentRequest";
import PaymentInstructions from "./pages/PaymentInstructions";
import PaymentRequests from "./pages/PaymentRequests";
import AdminPaymentRequests from "./pages/AdminPaymentRequests";
import AdminPanel, { AdminDashboard } from "./pages/AdminPanel";
import AdminUsers from "./pages/AdminUsers";
import AdminApplications from "./pages/AdminApplications";
import AdminInterviews from "./pages/AdminInterviews";
import Interview from "./pages/Interview";
import AdminDevices from "./pages/AdminDevices";
import AdminDeviceRequests from "./pages/AdminDeviceRequests";
import AdminMessages from "./pages/AdminMessages";
import AdminSEO from "./pages/AdminSEO";
import AdminEmailManagement from "./pages/AdminEmailManagement";
import AdminLegalManagement from "./pages/AdminLegalManagement";
import AdminSiteSettings from "./pages/AdminSiteSettings";
import AdminKyc from "./pages/AdminKyc";
import AdminResearchTasks from "./pages/AdminResearchTasks";
import LegalPolicies from "./pages/LegalPolicies";
import CookiePrivacyControls from "./components/CookiePrivacyControls";
import NotFound from "./pages/NotFound";
import AdminRoute from "./components/AdminRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import { AuthProvider } from "./lib/auth";

const queryClient = new QueryClient();

const pageTitles: Record<string, string> = {
  "/": "",
  "/how-it-works": "How It Works",
  "/payments": "Payments",
  "/success-stories": "Success Stories",
  "/faq": "FAQ",
  "/contact": "Contact",
  "/legal": "Legal & Policies",
  "/apply": "Application Portal",
  "/login": "Login",
  "/dashboard": "Dashboard",
  "/trusted-vendor": "Trusted Vendor",
  "/trusted-vendor/request-payment": "Request Payment",
  "/trusted-vendor/payment-instructions": "Payment Instructions",
  "/trusted-vendor/requests": "My Payment Requests",
  "/admin/payment-requests": "Payment Requests",
  "/admin": "Admin Dashboard",
  "/admin/users": "Admin Users",
  "/admin/applications": "Admin Applications",
  "/admin/kyc": "KYC Verification",
  "/admin/device-requests": "Admin Device Requests",
  "/admin/messages": "Admin Messages",
  "/admin/devices": "Admin Devices",
  "/admin/seo": "SEO Center",
  "/admin/email-management": "Email Management",
  "/admin/site-settings": "Site Settings",
};

function DocumentTitle() {
  const { pathname } = useLocation();
  const settings = usePublicSiteSettings();

  useEffect(() => {
    const siteTitle = settings?.seo.siteTitle || "Amazon Contributor Program";
    const pageTitle = pageTitles[pathname] ?? "";
    document.title = pageTitle ? `${siteTitle} | ${pageTitle}` : siteTitle;
    const seo = settings?.seo;
    if (!seo) return;

    const meta = (name: string, content: string, property = false) => {
      const attribute = property ? "property" : "name";
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, name);
        document.head.append(element);
      }
      element.content = content;
    };
    const isPublicPage = ["/", "/how-it-works", "/payments", "/success-stories", "/faq", "/contact", "/apply"].includes(pathname) || pathname === "/legal" || pathname.startsWith("/legal/");
    const origin = seo.canonicalUrl ? new URL(seo.canonicalUrl).origin : window.location.origin;
    const canonical = new URL(pathname, origin).toString();
    let canonicalElement = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (isPublicPage && !canonicalElement) {
      canonicalElement = document.createElement("link");
      canonicalElement.rel = "canonical";
      document.head.append(canonicalElement);
    }
    if (canonicalElement && isPublicPage) canonicalElement.href = canonical;
    if (canonicalElement && !isPublicPage) canonicalElement.remove();
    meta("description", seo.metaDescription);
    meta("keywords", seo.defaultKeywords);
    meta("robots", isPublicPage && seo.allowIndexing ? "index, follow" : "noindex, nofollow");
    meta("og:title", seo.ogTitle || siteTitle, true);
    meta("og:description", seo.ogDescription || seo.metaDescription, true);
    if (isPublicPage) meta("og:url", canonical, true);
    else document.head.querySelector('meta[property="og:url"]')?.remove();
    meta("og:type", "website", true);
    meta("twitter:card", seo.ogImage ? "summary_large_image" : "summary");
    meta("twitter:title", seo.twitterTitle || seo.ogTitle || siteTitle);
    meta("twitter:description", seo.twitterDescription || seo.ogDescription || seo.metaDescription);
    if (seo.ogImage) meta("og:image", new URL(seo.ogImage, origin).toString(), true);
  }, [pathname, settings]);

  return null;
}

function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const settings = usePublicSiteSettings();
  const isLoaded = useSiteSettingsLoaded();
  const isAdminArea = pathname.startsWith("/admin") || pathname === "/login";

  if (!isAdminArea && !isLoaded) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] text-sm font-semibold text-navy">Loading site…</div>;
  }
  if (!isAdminArea && settings?.site.maintenanceMode) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-5 py-16 text-ink"><section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_20px_60px_rgba(20,36,52,0.08)] sm:p-12"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-orange/10 text-orange"><Wrench size={25} /></span><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Temporarily unavailable</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">We’ll be back shortly</h1><p className="mt-4 text-sm leading-6 text-slate-500">{settings.site.maintenanceMessage}</p><div className="mt-8 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400"><ShieldCheck size={15} /> Your account and information remain secure</div></section></main>;
  }
  return <>{children}</>;
}

/** Key routes by their top-level segment so /admin/* sub-routes don't re-animate the whole admin shell. */
function routeKey(pathname: string) {
  if (pathname.startsWith("/admin")) return "/admin";
  return pathname;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <PageTransition key={routeKey(location.pathname)}>
        <Routes location={location}>
          <Route path="/" element={<Index />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/success-stories" element={<SuccessStories />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/legal" element={<LegalPolicies />} />
          <Route path="/legal/:slug" element={<LegalPolicies />} />
          <Route path="/apply" element={<Apply />} />
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute allowPending />}>
            <Route path="/interview" element={<Interview />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trusted-vendor" element={<TrustedVendor />} />
            <Route path="/trusted-vendor/request-payment" element={<PaymentRequest />} />
            <Route path="/trusted-vendor/payment-instructions" element={<PaymentInstructions />} />
            <Route path="/trusted-vendor/requests" element={<PaymentRequests />} />
            <Route element={<AdminRoute />}>
            <Route path="/admin/payment-requests" element={<AdminPaymentRequests />} />
            <Route path="/admin" element={<AdminPanel />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="applications" element={<AdminApplications />} />
              <Route path="interviews" element={<AdminInterviews />} />
              <Route path="device-requests" element={<AdminDeviceRequests />} />
              <Route path="kyc" element={<AdminKyc />} />
              <Route path="research-tasks" element={<AdminResearchTasks />} />
              <Route path="messages" element={<AdminMessages />} />
              <Route path="devices" element={<AdminDevices />} />
              <Route path="seo" element={<AdminSEO />} />
              <Route path="email-management" element={<AdminEmailManagement />} />
              <Route path="legal-management" element={<AdminLegalManagement />} />
              <Route path="site-settings" element={<AdminSiteSettings />} />
            </Route>
            </Route>
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageTransition>
    </AnimatePresence>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
      <Toaster />
      <Sonner />
      <PublicSiteSettingsProvider>
        <BrowserRouter>
          <DocumentTitle />
          <MaintenanceGate><AnimatedRoutes /></MaintenanceGate>
          <CookiePrivacyControls />
        </BrowserRouter>
      </PublicSiteSettingsProvider>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
