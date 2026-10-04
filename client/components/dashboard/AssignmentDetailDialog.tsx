import { Clock3, DollarSign, PlayCircle, X } from "lucide-react";
import type { Assignment } from "@/lib/assignments";

export default function AssignmentDetailDialog({
  assignment,
  isEligible,
  eligibilityLoading,
  deviceLoading,
  isStarting,
  startError,
  onClose,
  onStart,
}: {
  assignment: Assignment;
  isEligible: boolean;
  eligibilityLoading: boolean;
  deviceLoading: boolean;
  isStarting: boolean;
  startError: string;
  onClose: () => void;
  onStart: () => void;
}) {
  const canStart = assignment.status !== "Full" && isEligible && !eligibilityLoading && !deviceLoading && !isStarting;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isStarting) onClose(); }}>
      <section className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="assignment-detail-title">
        <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-orange/10 blur-3xl" />
        <header className="relative flex items-start justify-between gap-4 border-b border-slate-100 bg-[#fbfcfd] p-5 sm:p-7">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Assignment details</p>
            <h2 id="assignment-detail-title" className="mt-2 text-xl font-extrabold tracking-[-0.03em] text-navy sm:text-2xl">{assignment.title}</h2>
            <span className="mt-3 inline-flex rounded-md bg-orange/10 px-2.5 py-1 text-[10px] font-extrabold text-orange">{assignment.category}</span>
          </div>
          <button type="button" onClick={onClose} disabled={isStarting} aria-label="Close assignment details" className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy disabled:opacity-50"><X size={18} /></button>
        </header>

        <div className="relative p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-[#fbfcfd] p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Estimated time</p><p className="mt-2 flex items-center gap-2 text-sm font-extrabold text-navy"><Clock3 size={16} className="text-orange" />{assignment.estimatedTime}</p></div>
            <div className="rounded-lg border border-slate-200 bg-[#fbfcfd] p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Reward</p><p className="mt-2 flex items-center gap-2 text-sm font-extrabold text-navy"><DollarSign size={16} className="text-emerald-600" />${assignment.reward.toFixed(2)}</p></div>
            <div className="rounded-lg border border-slate-200 bg-[#fbfcfd] p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Availability</p><p className="mt-2 text-sm font-extrabold text-navy">{assignment.status}</p></div>
          </div>
          <div className="mt-6">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-navy">Full description &amp; instructions</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{assignment.description}</p>
          </div>
          {eligibilityLoading || deviceLoading ? <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500" role="status">Checking account and device eligibility…</div> : !isEligible ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800" role="status">Your account is not currently eligible to start assignments.</div> : null}
          {startError && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{startError}</div>}
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={isStarting} className="rounded-md border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600 transition hover:border-navy hover:text-navy disabled:opacity-50">Cancel</button>
            <button type="button" disabled={!canStart} onClick={() => {
              if (assignment.status === "Full" || !isEligible || eligibilityLoading || deviceLoading || isStarting) return;
              onStart();
            }} className="inline-flex items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50">
              <PlayCircle size={16} />{isStarting ? "Starting…" : assignment.status === "Full" ? "Unavailable" : "Start Task"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
