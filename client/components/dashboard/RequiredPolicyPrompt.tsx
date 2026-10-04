import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileText, X } from "lucide-react";
import { acknowledgePolicy, getMyPolicyAcknowledgements } from "@/lib/legal";
import type { LegalPolicy } from "@shared/legal";

export default function RequiredPolicyPrompt() {
  const [policy, setPolicy] = useState<LegalPolicy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecked, setIsChecked] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const load = async () => {
    const result = await getMyPolicyAcknowledgements();
    const acknowledged = new Set(result.acknowledgements.map((item) => item.policy_id));
    setPolicy(result.policies.find((item) => !acknowledged.has(item.id)) ?? null);
  };

  useEffect(() => {
    let active = true;
    void getMyPolicyAcknowledgements().then((result) => {
      if (!active) return;
      const acknowledged = new Set(result.acknowledgements.map((item) => item.policy_id));
      setPolicy(result.policies.find((item) => !acknowledged.has(item.id)) ?? null);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load required policies.");
    }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const confirm = async () => {
    if (!policy || !isChecked || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      await acknowledgePolicy(policy.id);
      await load();
      setIsChecked(false);
      setDismissed(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save acknowledgement.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || dismissed || !policy) return error && !isLoading ? <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null;

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm" role="presentation"><section className="relative flex max-h-[90vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="required-policy-title"><div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-[#fbfcfd] p-5 sm:p-6"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange/10 text-orange"><FileText size={19} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Required policy update · v{policy.version}</p><h2 id="required-policy-title" className="mt-1 text-lg font-extrabold text-navy">{policy.title}</h2></div></div><button type="button" aria-label="Review this policy later" onClick={() => setDismissed(true)} className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-navy"><X size={18} /></button></div><div className="overflow-y-auto p-5 sm:p-6"><p className="text-xs text-slate-500">Effective {new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${policy.effective_date}T00:00:00Z`))}</p><div className="mt-4 max-h-[38vh] overflow-y-auto rounded-lg border border-slate-200 bg-[#fbfcfd] p-4 text-sm leading-6 text-slate-600 whitespace-pre-wrap">{policy.content}</div><Link to={`/legal/${policy.policy_key}`} onClick={() => setDismissed(true)} className="mt-3 inline-block text-xs font-bold text-navy hover:text-orange">Open public policy page</Link><label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4"><input type="checkbox" checked={isChecked} onChange={(event) => setIsChecked(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange" /><span className="text-xs leading-5 text-slate-700">I have reviewed and acknowledge this version of the policy.</span></label>{error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}</div><div className="flex flex-col-reverse justify-between gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center sm:px-6"><p className="flex items-center gap-2 text-[11px] text-slate-500"><CheckCircle2 size={14} className="text-orange" />Your acknowledgement is saved to your account.</p><button type="button" onClick={() => void confirm()} disabled={!isChecked || isSaving} className="inline-flex items-center justify-center rounded-lg bg-orange px-5 py-3 text-xs font-extrabold text-navy disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? "Saving…" : "Acknowledge policy"}</button></div></section></div>;
}
