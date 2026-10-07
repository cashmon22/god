import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Eye,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { PaymentRequest, PaymentRequestStatus } from "@shared/payment-requests";
import { deletePaymentRequest, listPaymentRequests, updatePaymentRequestStatus } from "@/lib/payment-requests";
import { getAdminBankingDetails, type AdminBankingDetails } from "@/lib/banking-details";

const statusFilters = ["All", "Under Review", "Approved", "Rejected"] as const;
type StatusFilter = (typeof statusFilters)[number];

function referenceNumber(id: string) {
  return `AMZ-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatAmount(amount: number | null, currency = "USD") {
  if (amount === null) return "Price on request";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function adminStatus(status: PaymentRequestStatus): StatusFilter {
  return status === "Approved" || status === "Rejected" ? status : "Under Review";
}

function requestAddress(request: PaymentRequest) {
  return [request.deliveryAddress, request.city, request.stateProvince, request.postalCode, request.country].filter(Boolean).join(", ");
}

function StatusBadge({ status }: { status: StatusFilter }) {
  const styles: Record<StatusFilter, string> = {
    "Under Review": "bg-amber-50 text-amber-700 border-amber-200",
    Approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Rejected: "bg-red-50 text-red-700 border-red-200",
    All: "",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${styles[status]}`}>
      {status === "Approved" && <Check size={10} />}
      {status === "Rejected" && <X size={10} />}
      {status === "Under Review" && <Clock3 size={10} />}
      {status}
    </span>
  );
}

export default function AdminDeviceRequests() {
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<StatusFilter>("All");
  const [selectedRequest, setSelectedRequest] = useState<PaymentRequest | null>(null);
  const [bankingReview, setBankingReview] = useState<AdminBankingDetails | null>(null);
  const [bankingReviewLoading, setBankingReviewLoading] = useState(false);
  const [bankingReviewError, setBankingReviewError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState("");
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ type: "approve" | "reject" | "delete"; request: PaymentRequest } | null>(null);

  const loadRequests = async () => {
    setIsLoading(true);
    setError("");
    try {
      setRequests(await listPaymentRequests());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load device requests.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadRequests(); }, []);

  useEffect(() => {
    if (!selectedRequest) {
      setBankingReview(null);
      return;
    }
    let active = true;
    setBankingReviewLoading(true);
    setBankingReviewError("");
    void getAdminBankingDetails(selectedRequest.id).then((review) => {
      if (active) setBankingReview(review);
    }).catch((loadError) => {
      if (active) setBankingReviewError(loadError instanceof Error ? loadError.message : "Unable to load payment review details.");
    }).finally(() => {
      if (active) setBankingReviewLoading(false);
    });
    return () => { active = false; };
  }, [selectedRequest?.id, selectedRequest?.status]);

  const filteredRequests = useMemo(() => {
    const query = submittedSearch.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesSearch = !query ||
        request.fullLegalName.toLowerCase().includes(query) ||
        request.email.toLowerCase().includes(query) ||
        request.deviceName.toLowerCase().includes(query) ||
        request.deviceModel.toLowerCase().includes(query) ||
        referenceNumber(request.id).toLowerCase().includes(query);
      const matchesFilter = activeFilter === "All" || adminStatus(request.status) === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [requests, submittedSearch, activeFilter]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
  };

  const handleApprove = async (request: PaymentRequest) => {
    setIsUpdating(true);
    setError("");
    try {
      await updatePaymentRequestStatus(request.id, "Approved");
      const updated = { ...request, status: "Approved" as PaymentRequestStatus, rejectionReason: null };
      setRequests((current) => current.map((r) => (r.id === request.id ? updated : r)));
      setSelectedRequest(updated);
      setConfirmAction(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to approve request.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReject = async (request: PaymentRequest, reason: string) => {
    setIsUpdating(true);
    setError("");
    try {
      await updatePaymentRequestStatus(request.id, "Rejected", reason || undefined);
      const updated = { ...request, status: "Rejected" as PaymentRequestStatus, rejectionReason: reason || null, reviewedAt: new Date().toISOString() };
      setRequests((current) => current.map((r) => (r.id === request.id ? updated : r)));
      setSelectedRequest(updated);
      setRejectMode(false);
      setRejectReason("");
      setConfirmAction(null);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to reject request.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (request: PaymentRequest) => {
    setIsUpdating(true);
    setError("");
    try {
      await deletePaymentRequest(request.id);
      setRequests((current) => current.filter((r) => r.id !== request.id));
      setSelectedRequest(null);
      setConfirmAction(null);
      toast.success("Device request and linked conversation deleted.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to delete request.");
      toast.error("Unable to delete device request.");
    } finally {
      setIsUpdating(false);
    }
  };

  const stats = useMemo(() => ({
    total: requests.length,
    underReview: requests.filter((r) => adminStatus(r.status) === "Under Review").length,
    approved: requests.filter((r) => r.status === "Approved").length,
    rejected: requests.filter((r) => r.status === "Rejected").length,
  }), [requests]);

  return (
    <section aria-labelledby="device-requests-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Operations</p>
          <h2 id="device-requests-heading" className="mt-2 text-[32px] font-extrabold tracking-[-0.04em] text-navy sm:text-[40px]">Device Requests</h2>
          <p className="mt-3 max-w-[580px] text-sm leading-6 text-slate-500">Review device payment requests from contributors, inspect applicant details, and approve or reject submissions.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><ShieldCheck size={16} className="text-orange" /> Protected administrator data</div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Requests" value={isLoading ? "—" : stats.total} icon={Monitor} />
        <StatCard label="Under Review" value={isLoading ? "—" : stats.underReview} icon={Clock3} />
        <StatCard label="Approved" value={isLoading ? "—" : stats.approved} icon={CheckCircle2} />
        <StatCard label="Rejected" value={isLoading ? "—" : stats.rejected} icon={XCircle} />
      </div>

      {error && (
        <div className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <div className="flex items-start gap-2"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss error" className="rounded p-1 text-red-500 hover:bg-red-100"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <div className="mt-7 flex flex-wrap gap-2">
        {statusFilters.map((filter) => (
          <button key={filter} type="button" onClick={() => setActiveFilter(filter)}
            className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${activeFilter === filter ? "bg-navy text-white" : "border border-slate-200 bg-white text-slate-600 hover:border-navy/30 hover:text-navy"}`}>
            {filter}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-5">
        <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={handleSearch}>
          <label className="relative">
            <span className="sr-only">Search device requests</span>
            <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by applicant, email, device, or reference number"
              className="h-11 w-full rounded-lg border border-slate-200 bg-[#fbfcfd] pl-10 pr-3 text-sm text-navy outline-none transition placeholder:text-slate-400 focus:border-orange focus:ring-2 focus:ring-orange/10" />
          </label>
          <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-navy px-5 text-xs font-extrabold text-white transition hover:bg-navy/90">
            <Search size={15} /> Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_3px_16px_rgba(20,36,52,0.04)]">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h3 className="text-sm font-extrabold text-navy">Request queue</h3>
            <p className="mt-1 text-xs text-slate-500">
              {isLoading ? "Loading requests..." : `${filteredRequests.length} request${filteredRequests.length === 1 ? "" : "s"}${submittedSearch ? ` matching "${submittedSearch}"` : ""}`}
            </p>
          </div>
          <button type="button" onClick={() => void loadRequests()} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 transition hover:text-orange">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 px-5 py-16 text-sm font-semibold text-slate-500" role="status">
            <LoaderCircle size={18} className="animate-spin text-orange" /> Loading device requests...
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Monitor size={26} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-bold text-navy">No device requests found</p>
            <p className="mt-1 text-xs text-slate-500">Try changing your search or filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-left">
              <thead className="bg-[#fbfcfd] text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-6 py-3">Applicant</th>
                  <th className="px-6 py-3">Device</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Reference</th>
                  <th className="px-6 py-3">Submitted</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRequests.map((request) => (
                  <tr key={request.id} className="transition hover:bg-[#fbfcfd]">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-navy">{request.fullLegalName}</p>
                      <p className="mt-1 text-xs text-slate-500">{request.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-semibold text-navy">{request.deviceName}</p>
                      <p className="mt-1 text-xs text-slate-500">{request.deviceModel}</p>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-semibold text-navy">{formatAmount(request.deviceAmount, request.currency)}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs font-extrabold text-navy">{referenceNumber(request.id)}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-xs text-slate-500">{formatDate(request.createdAt)}</td>
                    <td className="px-6 py-4"><StatusBadge status={adminStatus(request.status)} /></td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => { setSelectedRequest(request); setRejectMode(false); setRejectReason(""); }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-navy transition hover:border-orange/40 hover:text-orange">
                          <Eye size={14} /> Open
                        </button>
                        <button type="button" onClick={() => setConfirmAction({ type: "delete", request })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50">
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          role="dialog" aria-modal="true" aria-label="Device request details"
          onMouseDown={(e) => { if (e.target === e.currentTarget && !isUpdating && !rejectMode) setSelectedRequest(null); }}>
          <section className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-white p-6 shadow-2xl sm:rounded-xl sm:p-7">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Device request</p>
                <h3 className="mt-2 text-xl font-extrabold text-navy">{referenceNumber(selectedRequest.id)}</h3>
                <div className="mt-2"><StatusBadge status={adminStatus(selectedRequest.status)} /></div>
              </div>
              <button type="button" onClick={() => { if (!isUpdating && !rejectMode) setSelectedRequest(null); }} disabled={isUpdating}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy disabled:opacity-50" aria-label="Close request details">
                <X size={18} />
              </button>
            </div>

            {/* Applicant Information */}
            <div className="mt-6">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Applicant Information</h4>
              <div className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-[#fbfcfd] p-5 sm:grid-cols-2">
                <DetailField label="Full name" value={selectedRequest.fullLegalName} />
                <DetailField label="Email" value={selectedRequest.email} />
                <DetailField label="Phone" value={selectedRequest.phone} />
                <DetailField label="Shipping address" value={requestAddress(selectedRequest)} />
                <DetailField label="Country" value={selectedRequest.country} />
              </div>
            </div>

            {/* Device Information */}
            <div className="mt-5">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Device Information</h4>
              <div className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-[#fbfcfd] p-5 sm:grid-cols-2">
                <DetailField label="Device name" value={selectedRequest.deviceName} />
                <DetailField label="Model" value={selectedRequest.deviceModel} />
                <DetailField label="Device amount" value={formatAmount(selectedRequest.deviceAmount, selectedRequest.currency)} />
                <DetailField label="Reference number" value={referenceNumber(selectedRequest.id)} />
                <DetailField label="Submission date" value={formatDate(selectedRequest.createdAt)} />
              </div>
            </div>

            {/* Request Status */}
            <div className="mt-5">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Request Status</h4>
              <div className="mt-3 rounded-lg border border-slate-200 bg-[#fbfcfd] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Current status</p>
                    <div className="mt-2"><StatusBadge status={adminStatus(selectedRequest.status)} /></div>
                  </div>
                  {selectedRequest.reviewedAt && (
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Last updated</p>
                      <p className="mt-2 text-xs font-semibold text-slate-600">{formatDate(selectedRequest.reviewedAt)}</p>
                    </div>
                  )}
                </div>
                {selectedRequest.rejectionReason && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-red-500">Rejection reason</p>
                    <p className="mt-1 text-sm leading-5 text-red-800">{selectedRequest.rejectionReason}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Payment and verification</h4>
              {bankingReviewLoading ? <p className="mt-3 rounded-lg border border-slate-200 bg-[#fbfcfd] p-4 text-xs text-slate-500">Loading payment details…</p> : bankingReviewError ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800" role="alert">{bankingReviewError}</p> : bankingReview && (
                <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-[#fbfcfd] p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DetailField label="Payment status" value={bankingReview.paymentStatus} />
                    <DetailField label="KYC status" value={bankingReview.kycStatus} />
                    <DetailField label="Banking details" value={bankingReview.submitted ? "Submitted" : "Not submitted"} />
                    <DetailField label="Submission date" value={bankingReview.submittedAt ? formatDate(bankingReview.submittedAt) : "—"} />
                    <DetailField label="Device approval status" value={bankingReview.deviceApprovalStatus} />
                  </div>
                  {bankingReview.bankingDetails && <div className="border-t border-slate-200 pt-4"><h5 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Submitted check payment information</h5><div className="mt-3 grid gap-4 sm:grid-cols-2"><DetailField label="Check payee name" value={bankingReview.bankingDetails.payeeName} /><DetailField label="Mailing address" value={[bankingReview.bankingDetails.addressLine1, bankingReview.bankingDetails.addressLine2, bankingReview.bankingDetails.city, bankingReview.bankingDetails.stateProvince, bankingReview.bankingDetails.postalCode, bankingReview.bankingDetails.country].filter(Boolean).join(", ")} /></div></div>}
                </div>
              )}
            </div>

            {/* Admin actions */}
            {adminStatus(selectedRequest.status) !== "Approved" && adminStatus(selectedRequest.status) !== "Rejected" && !rejectMode && (
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button type="button" disabled={isUpdating} onClick={() => setConfirmAction({ type: "approve", request: selectedRequest })}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-xs font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <CheckCircle2 size={15} /> Approve Request
                </button>
                <button type="button" disabled={isUpdating} onClick={() => setRejectMode(true)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-xs font-extrabold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <XCircle size={15} /> Reject Request
                </button>
              </div>
            )}

            {/* Reject reason input */}
            {rejectMode && (
              <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5">
                <p className="text-xs font-extrabold text-navy">Rejection reason (optional)</p>
                <p className="mt-1 text-xs text-slate-500">Provide a reason that will be visible to the applicant.</p>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
                  placeholder="Enter rejection reason..."
                  className="mt-3 w-full resize-none rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
                <div className="mt-4 flex gap-2">
                  <button type="button" disabled={isUpdating} onClick={() => { setRejectMode(false); setRejectReason(""); }}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:border-slate-300 disabled:opacity-50">
                    Cancel
                  </button>
                  <button type="button" disabled={isUpdating} onClick={() => void handleReject(selectedRequest, rejectReason)}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {isUpdating && <LoaderCircle size={14} className="animate-spin" />} Confirm Rejection
                  </button>
                </div>
              </div>
            )}

            {/* Already processed badge */}
            {(adminStatus(selectedRequest.status) === "Approved" || adminStatus(selectedRequest.status) === "Rejected") && !rejectMode && (
              <div className={`mt-6 rounded-lg border p-4 text-center ${adminStatus(selectedRequest.status) === "Approved" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <p className={`text-sm font-extrabold ${adminStatus(selectedRequest.status) === "Approved" ? "text-emerald-700" : "text-red-700"}`}>
                  This request has been {adminStatus(selectedRequest.status).toLowerCase()}
                </p>
              </div>
            )}

            {/* Delete action — always available in detail view */}
            {!rejectMode && (
              <button type="button" disabled={isUpdating} onClick={() => setConfirmAction({ type: "delete", request: selectedRequest })}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 size={14} /> Delete Request
              </button>
            )}
          </section>
        </div>
      )}

      {/* Approve confirmation */}
      {confirmAction?.type === "approve" && (
        <ConfirmDialog
          title="Approve this device request?"
          message={`Approve the request from ${confirmAction.request.fullLegalName} for ${confirmAction.request.deviceName}? The applicant will be notified of the approval.`}
          confirmLabel="Approve Request"
          confirmClass="bg-emerald-600 hover:bg-emerald-700"
          icon={CheckCircle2}
          isUpdating={isUpdating}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void handleApprove(confirmAction.request)}
        />
      )}

      {/* Delete confirmation */}
      {confirmAction?.type === "delete" && (
        <ConfirmDialog
          title="Delete this device request?"
          message={`Permanently delete the request from ${confirmAction.request.fullLegalName} for ${confirmAction.request.deviceName} (Ref: ${referenceNumber(confirmAction.request.id)})? This action cannot be undone.`}
          confirmLabel="Delete Request"
          confirmClass="bg-red-600 hover:bg-red-700"
          icon={Trash2}
          isUpdating={isUpdating}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void handleDelete(confirmAction.request)}
        />
      )}
    </section>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Monitor }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_3px_16px_rgba(20,36,52,0.04)]">
      <div className="flex items-start justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange/10 text-orange"><Icon size={19} /></span>
      </div>
      <p className="mt-5 text-3xl font-extrabold tracking-tight text-navy">{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm leading-6 text-navy">{value || "—"}</p>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, confirmClass, icon: Icon, isUpdating, onCancel, onConfirm }: {
  title: string; message: string; confirmLabel: string; confirmClass: string; icon: typeof CheckCircle2; isUpdating: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-orange/10 text-orange"><Icon size={19} /></div>
        <h3 className="mt-5 text-lg font-extrabold text-navy">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={isUpdating} className="rounded-lg border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={isUpdating} className={`inline-flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-extrabold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${confirmClass}`}>
            {isUpdating && <LoaderCircle size={14} className="animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
