import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleProgramStatus } from "./routes/program";
import { getAdminDashboardStats, getAdminReviewCounts } from "./routes/admin-dashboard";
import {
  createPaymentRequest,
  deletePaymentRequest,
  listPaymentRequests,
  updatePaymentRequestStatus,
} from "./routes/payment-requests";
import {
  createAdminUser,
  deleteAdminUser,
  getAdminUserDetails,
  getAdminContributorOverview,
  listAdminUsers,
  updateAdminUserStatus,
} from "./routes/admin-users";
import {
  deleteAdminApplication,
  getAdminApplicationDetails,
  listAdminApplications,
  mirrorApplication,
  getMyApplication,
  updateAdminApplicationStatus,
  updateAdminApplicationVerification,
} from "./routes/admin-applications";
import {
  addUserBalance,
  getUserBalance,
  listBalanceTransactions,
  removeUserBalance,
} from "./routes/admin-balance";
import {
  adminCreateSupportConversation,
  createOrGetConversation,
  deleteAdminConversation,
  getConversation,
  getOrCreateSupportConversation,
  listConversations,
  markConversationRead,
  sendMessage,
} from "./routes/vendor-messages";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./routes/notifications";
import { listContributorTasks, startContributorTask } from "./routes/contributor-tasks";
import { getContributorReferrals } from "./routes/referrals";
import { acknowledgePolicy, listAdminPolicies, listMyPolicyAcknowledgements, listPublicPolicies, saveAdminPolicy } from "./routes/legal";
import { getAdminSiteSettings, getPublicSiteSettings, updateAdminSiteSettings } from "./routes/site-settings";
import { requireInterviewApproval } from "./lib/interview-access";
import {
  createInterviewQuestion,
  deleteInterviewQuestion,
  getInterviewAccess,
  getInterviewQuestions,
  getMyInterview,
  saveInterviewAnswer,
  startInterview,
  startInterviewQuestion,
  listAdminInterviews,
  reorderInterviewQuestions,
  submitInterview,
  updateInterviewQuestion,
  updateInterviewStatus,
} from "./routes/interviews";
import { getContributorEarnings } from "./routes/contributor-earnings";
import { getAdminBankingDetails, getMyBankingDetailsStatus, submitBankingDetails } from "./routes/banking-details";
import { createKycDraft, getAdminKyc, getAdminKycInstructions, getKycInstructions, getMyKyc, getMyKycStatus, listAdminKyc, reviewKyc, saveAdminKycInstructions, saveKycDraft, submitKyc, uploadKycFile } from "./routes/kyc";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/program/status", handleProgramStatus);
  app.get("/api/site/settings", getPublicSiteSettings);
  app.get("/api/admin/site-settings", getAdminSiteSettings);
  app.put("/api/admin/site-settings/:section", updateAdminSiteSettings);
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(
      "User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /dashboard\nDisallow: /trusted-vendor\nDisallow: /interview\nDisallow: /admin\nDisallow: /api\n\nSitemap: https://workforcecontributors.netlify.app/sitemap.xml\n",
    );
  });
  app.get("/sitemap.xml", (_req, res) => {
    const origin = "https://workforcecontributors.netlify.app";
    const paths = ["/", "/how-it-works", "/payments", "/success-stories", "/faq", "/contact", "/apply", "/legal"];
    const lastmod = "2026-10-03";
    const urls = paths
      .map((path) => `<url><loc>${xmlEscape(new URL(path, origin).toString())}</loc><lastmod>${lastmod}</lastmod></url>`)
      .join("");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });
  app.use("/api/contributor", requireInterviewApproval);
  app.use("/api/kyc", requireInterviewApproval);
  app.use("/api/payment-requests", requireInterviewApproval);
  app.use("/api/vendor-conversations", requireInterviewApproval);
  app.use("/api/notifications", requireInterviewApproval);
  app.post("/api/payment-requests", createPaymentRequest);
  app.get("/api/payment-requests", listPaymentRequests);
  app.get("/api/payment-requests/:id/banking-details", getMyBankingDetailsStatus);
  app.post("/api/payment-requests/:id/banking-details", submitBankingDetails);
  app.get("/api/admin/payment-requests/:id/banking-details", getAdminBankingDetails);
  app.patch(
    "/api/admin/payment-requests/:id/status",
    updatePaymentRequestStatus,
  );
  app.delete("/api/admin/payment-requests/:id", deletePaymentRequest);
  app.get("/api/admin/dashboard-stats", getAdminDashboardStats);
  app.get("/api/admin/review-counts", getAdminReviewCounts);
  app.get("/api/admin/users", listAdminUsers);
  app.post("/api/admin/users", createAdminUser);
  app.get("/api/admin/users/:id/overview", getAdminContributorOverview);
  app.get("/api/admin/users/:id", getAdminUserDetails);
  app.patch("/api/admin/users/:id/status", updateAdminUserStatus);
  app.delete("/api/admin/users/:id", deleteAdminUser);
  app.get("/api/admin/users/:id/balance", getUserBalance);
  app.post("/api/admin/users/:id/balance/add", addUserBalance);
  app.post("/api/admin/users/:id/balance/remove", removeUserBalance);
  app.get("/api/admin/users/:id/balance/transactions", listBalanceTransactions);
  app.get("/api/contributor/referrals", getContributorReferrals);
  app.get("/api/legal/policies", listPublicPolicies);
  app.get("/api/legal/acknowledgements", listMyPolicyAcknowledgements);
  app.post("/api/legal/acknowledgements", acknowledgePolicy);
  app.get("/api/admin/legal/policies", listAdminPolicies);
  app.post("/api/admin/legal/policies", saveAdminPolicy);
  app.post("/api/applications/mirror", mirrorApplication);
  app.get("/api/applications/me", getMyApplication);
  app.get("/api/interview/access", getInterviewAccess);
  app.get("/api/interview/questions", getInterviewQuestions);
  app.get("/api/interview/me", getMyInterview);
  app.post("/api/interview/sessions", startInterview);
  app.post("/api/interview/sessions/question", startInterviewQuestion);
  app.patch("/api/interview/sessions/answer", saveInterviewAnswer);
  app.post("/api/interview/submissions", submitInterview);
  app.get("/api/admin/interviews", listAdminInterviews);
  app.patch("/api/admin/interviews/:id/status", updateInterviewStatus);
  app.post("/api/admin/interview-questions", createInterviewQuestion);
  app.put("/api/admin/interview-questions/order", reorderInterviewQuestions);
  app.patch("/api/admin/interview-questions/:id", updateInterviewQuestion);
  app.delete("/api/admin/interview-questions/:id", deleteInterviewQuestion);
  app.get("/api/contributor/earnings", getContributorEarnings);
  app.get("/api/kyc/instructions", getKycInstructions);
  app.get("/api/kyc/me", getMyKyc);
  app.get("/api/kyc/status", getMyKycStatus);
  app.post("/api/kyc/drafts", createKycDraft);
  app.patch("/api/kyc/drafts/:id", saveKycDraft);
  app.post("/api/kyc/drafts/:id/files/:kind", uploadKycFile);
  app.post("/api/kyc/submit", submitKyc);
  app.get("/api/admin/kyc", listAdminKyc);
  app.get("/api/admin/kyc/instructions", getAdminKycInstructions);
  app.put("/api/admin/kyc/instructions", saveAdminKycInstructions);
  app.get("/api/admin/kyc/:id", getAdminKyc);
  app.patch("/api/admin/kyc/:id/review", reviewKyc);
  app.get("/api/admin/applications", listAdminApplications);
  app.get("/api/admin/applications/:id", getAdminApplicationDetails);
  app.patch("/api/admin/applications/:id/status", updateAdminApplicationStatus);
  app.delete("/api/admin/applications/:id", deleteAdminApplication);
  app.patch("/api/admin/applications/:id/verification", updateAdminApplicationVerification);

  // Vendor + Support messaging
  app.post("/api/vendor-conversations", createOrGetConversation);
  app.get("/api/vendor-conversations", listConversations);
  app.get("/api/vendor-conversations/support", getOrCreateSupportConversation);
  app.get("/api/vendor-conversations/:id", getConversation);
  app.delete("/api/admin/vendor-conversations/:id", deleteAdminConversation);
  app.post("/api/vendor-conversations/:id/messages", sendMessage);
  app.patch("/api/vendor-conversations/:id/read", markConversationRead);
  app.post("/api/admin/support-conversations", adminCreateSupportConversation);

  // Notifications
  app.get("/api/notifications", listNotifications);
  app.patch("/api/notifications/:id/read", markNotificationRead);
  app.patch("/api/notifications/read-all", markAllNotificationsRead);
  app.get("/api/contributor/tasks", listContributorTasks);
  app.post("/api/contributor/tasks", startContributorTask);

  return app;
}

function xmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}
