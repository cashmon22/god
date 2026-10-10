import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, CircleCheck, LockKeyhole, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { PaymentRequest } from "@shared/payment-requests";
import { getMyBankingDetailsStatus, submitBankingDetails, type CheckPaymentDetails } from "@/lib/banking-details";

const emptyDetails: CheckPaymentDetails = {
  payeeName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateProvince: "",
  postalCode: "",
  country: "",
};

function initialDetails(request: PaymentRequest): CheckPaymentDetails {
  return {
    ...emptyDetails,
    payeeName: request.fullLegalName,
    addressLine1: request.deliveryAddress,
    city: request.city,
    stateProvince: request.stateProvince,
    postalCode: request.postalCode,
    country: request.country,
  };
}

function fieldClass() {
  return "mt-1.5 h-11 w-full rounded-md border border-slate-200 bg-[#fbfcfd] px-3 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10";
}

export default function ApprovedDeviceSetup({ request, onOpenInstructions }: { request: PaymentRequest; onOpenInstructions: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [details, setDetails] = useState(() => initialDetails(request));
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getMyBankingDetailsStatus(request.id).then((status) => {
      if (active) setSubmitted(status.submitted);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load check payment status.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [request.id]);

  const setField = (field: keyof CheckPaymentDetails, value: string) => {
    setDetails((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])) as CheckPaymentDetails;
    if (!normalized.payeeName || !normalized.addressLine1 || !normalized.city || !normalized.stateProvince || !normalized.postalCode || !normalized.country) {
      setError("Complete all required fields before submitting.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await submitBankingDetails(request.id, normalized);
      setDetails(normalized);
      setSubmitted(true);
      setIsFormOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit check payment details.");
    } finally {
      setIsSaving(false);
    }
  };

  return <>
    <section className="rounded-xl border border-emerald-200 bg-white p-5 shadow-card sm:p-6" aria-labelledby="device-setup-title">
      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><CheckCircle2 size={17} /></span><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Approved device</p><h2 id="device-setup-title" className="mt-0.5 text-sm font-extrabold text-navy">Device Setup</h2></div></div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {submitted ? (
          <p className="inline-flex items-center gap-2 text-xs font-extrabold text-emerald-700" role="status"><CircleCheck size={15} /> Banking Details Submitted ✓</p>
        ) : (
          <button type="button" onClick={() => { setError(""); setIsFormOpen(true); }} disabled={isLoading || isSaving} className="inline-flex items-center justify-center gap-2 rounded-md border border-orange/40 bg-orange/10 px-4 py-2.5 text-xs font-extrabold text-navy transition hover:bg-orange/20 disabled:cursor-wait disabled:opacity-60">Submit Your Banking Details <ArrowRight size={14} /></button>
        )}
        <button type="button" onClick={onOpenInstructions} disabled={!submitted || isLoading} aria-disabled={!submitted || isLoading} className="inline-flex items-center justify-center gap-2 rounded-md bg-navy px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-[#1d3042] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200">
          {!submitted && <LockKeyhole size={14} />} View Instructions {submitted && <ArrowRight size={14} />}
        </button>
        {isLoading && <span className="text-[11px] text-slate-400">Checking submission status…</span>}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-600">Your device has been approved and is ready for setup.</p>
      {error && !isFormOpen && <p className="mt-3 text-xs text-red-700" role="alert">{error}</p>}
    </section>

    {isFormOpen && (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setIsFormOpen(false); }}>
        <section className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7" role="dialog" aria-modal="true" aria-labelledby="check-details-title">
          <button type="button" onClick={() => setIsFormOpen(false)} disabled={isSaving} aria-label="Close banking details form" className="absolute right-4 top-4 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy disabled:opacity-50"><X size={18} /></button>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ShieldCheck size={21} /></span>
          <h2 id="check-details-title" className="mt-4 pr-8 text-xl font-extrabold text-navy">Submit Your Banking Details</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Enter the payee and mailing address where your check should be sent. Bank account and routing numbers are not required.</p>
          <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-navy sm:col-span-2">Check payee name <span className="text-red-600">* Required</span><input required maxLength={160} autoComplete="name" value={details.payeeName} onChange={(event) => setField("payeeName", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy sm:col-span-2">Mailing address <span className="text-red-600">* Required</span><input required maxLength={200} autoComplete="address-line1" value={details.addressLine1} onChange={(event) => setField("addressLine1", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy sm:col-span-2">Address line 2 <span className="font-normal text-slate-400">(Optional)</span><input maxLength={200} autoComplete="address-line2" value={details.addressLine2} onChange={(event) => setField("addressLine2", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy">City <span className="text-red-600">* Required</span><input required maxLength={100} autoComplete="address-level2" value={details.city} onChange={(event) => setField("city", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy">State / Province <span className="text-red-600">* Required</span><input required maxLength={100} autoComplete="address-level1" value={details.stateProvince} onChange={(event) => setField("stateProvince", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy">Postal code <span className="text-red-600">* Required</span><input required maxLength={24} autoComplete="postal-code" value={details.postalCode} onChange={(event) => setField("postalCode", event.target.value)} className={fieldClass()} /></label>
              <label className="text-xs font-bold text-navy">Country <span className="text-red-600">* Required</span><input required maxLength={100} autoComplete="country-name" value={details.country} onChange={(event) => setField("country", event.target.value)} className={fieldClass()} /></label>
            </div>
            {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert">{error}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setIsFormOpen(false)} disabled={isSaving} className="rounded-md border border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 transition hover:border-slate-300 disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-md bg-navy px-4 py-3 text-xs font-extrabold text-white transition hover:bg-[#1d3042] disabled:cursor-wait disabled:opacity-60">{isSaving && <LoaderCircle size={14} className="animate-spin" />} Submit Details</button>
            </div>
          </form>
        </section>
      </div>
    )}
  </>;
}
