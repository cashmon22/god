import { MonitorCheck, ShieldCheck, X } from "lucide-react";

interface DeviceNotRecognizedModalProps {
  onClose: () => void;
  onVerifyDevice: () => void;
}

export default function DeviceNotRecognizedModal({ onClose, onVerifyDevice }: DeviceNotRecognizedModalProps) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-navy/65 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-verification-title"
        aria-describedby="device-verification-description"
      >
        <header className="flex items-center gap-3 border-b border-slate-100 bg-[#fbfcfd] px-5 py-4 sm:px-6">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy text-orange shadow-[0_8px_20px_rgba(19,30,41,0.14)]">
            <MonitorCheck size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">Security check</p>
            <h2 id="device-verification-title" className="mt-1 text-lg font-extrabold tracking-[-0.03em] text-navy sm:text-xl">
              Device not recognized
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close device verification" className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-navy">
            <X size={18} />
          </button>
        </header>
        <div className="p-5 sm:p-6">
          <p id="device-verification-description" className="text-sm leading-6 text-slate-600">
            For your security, this action can only be completed from a verified device. Please verify this device before continuing.
          </p>
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-orange/25 bg-orange/[0.06] p-4">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-orange" />
            <p className="text-xs leading-5 text-slate-600">Your account and earnings remain protected while you complete device verification.</p>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-navy">
              Cancel
            </button>
            <button type="button" onClick={onVerifyDevice} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-orange px-4 text-sm font-extrabold text-navy transition hover:bg-orange-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2">
              <MonitorCheck size={16} /> Verify Device
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
