import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Clock3, FileText, RefreshCw, Search, Send, UserPlus, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import type { AdminResearchReviewTask, AdminResearchTask } from "@/lib/research-tasks";
import { createAdminResearchTask, getAdminResearchTask, listAdminResearchTasks, reviewAdminResearchTask } from "@/lib/research-tasks";
import { listAdminUsers } from "@/lib/admin-users";
import type { AdminUser } from "@shared/admin-users";
import { PRODUCT_RESEARCH_TEMPLATE, type ProductResearchDraft, type ProductResearchEvidence } from "@shared/product-research";

function when(value: string | null) {
  return value ? formatDistanceToNow(new Date(value), { addSuffix: true }) : "Not yet";
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return <div className="rounded-lg bg-slate-50 p-3"><p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</p></div>;
}

function EvidenceList({ evidence }: { evidence: ProductResearchEvidence[] }) {
  const items = evidence.filter((item) => item.sourceUrl || item.notes || item.fileName);
  if (!items.length) return <p className="text-xs text-slate-400">No evidence attached.</p>;
  return <ul className="space-y-2">{items.map((item, index) => <li key={index} className="rounded-lg border border-slate-200 p-3 text-xs"><div className="flex flex-wrap gap-3">{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="font-bold text-blue-700 underline">Source URL</a>}{item.fileName && ((item as ProductResearchEvidence & { fileUrl?: string }).fileUrl ? <a href={(item as ProductResearchEvidence & { fileUrl?: string }).fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-blue-700 underline"><FileText size={13} />{item.fileName}</a> : <span className="font-bold text-slate-500">{item.fileName}</span>)}</div>{item.notes && <p className="mt-2 whitespace-pre-wrap leading-5 text-slate-600">{item.notes}</p>}</li>)}</ul>;
}

function SubmissionReview({ task, onClose, onReviewed }: { task: AdminResearchReviewTask; onClose: () => void; onReviewed: () => void }) {
  const [decision, setDecision] = useState<"Approved" | "Changes Requested" | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const draft = task.submission?.snapshot.draft;

  const submitDecision = async () => {
    if (!decision || (decision === "Changes Requested" && !message.trim()) || working) return;
    setWorking(true);
    try {
      await reviewAdminResearchTask(task.id, decision, message.trim() || undefined);
      toast.success(decision === "Approved" ? "Assignment approved and completed." : "Changes sent to the contributor.");
      onReviewed();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the review.");
    } finally {
      setWorking(false);
    }
  };

  return <div className="fixed inset-0 z-[100] overflow-y-auto bg-navy/55 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="mx-auto my-3 max-w-5xl rounded-xl bg-white shadow-2xl sm:my-6" role="dialog" aria-modal="true" aria-labelledby="submission-review-title"><div className="sticky top-0 z-10 flex items-start justify-between gap-4 rounded-t-xl border-b border-slate-200 bg-white p-5 sm:p-6"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">Product Research · Revision {task.submission?.revision ?? "—"}</p><h2 id="submission-review-title" className="mt-1 text-xl font-extrabold text-navy sm:text-2xl">Submission review</h2><p className="mt-1 text-xs text-slate-500">{task.contributor} · {task.productName} · {task.status}</p></div><button type="button" onClick={onClose} aria-label="Close submission" className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-navy"><X size={19} /></button></div>
    <div className="space-y-6 p-5 sm:p-6">{!draft ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No submitted snapshot is available for this assignment yet.</div> : <>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Product Information</h3><div className="grid gap-3 sm:grid-cols-2"><Detail label="Product name" value={draft.productInformation.productName} /><Detail label="Category" value={draft.productInformation.category} /><Detail label="Price" value={draft.productInformation.price} /><Detail label="Rating" value={draft.productInformation.rating} /><Detail label="Other information" value={draft.productInformation.otherInformation} /><div><p className="mb-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">Product source</p><EvidenceList evidence={[{ sourceUrl: draft.productInformation.sourceUrl, notes: "", }]} /></div></div><div className="mt-3"><EvidenceList evidence={draft.productInformation.evidence} /></div></section>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Product Features</h3><div className="grid gap-3 sm:grid-cols-2"><Detail label="Main features" value={draft.productFeatures.mainFeatures} /><Detail label="Benefits" value={draft.productFeatures.benefits} /><Detail label="Strengths" value={draft.productFeatures.strengths} /><Detail label="Weaknesses" value={draft.productFeatures.weaknesses} /><Detail label="Observations" value={draft.productFeatures.observations} /></div><div className="mt-3"><EvidenceList evidence={draft.productFeatures.evidence} /></div></section>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Competitor Research</h3><div className="space-y-3">{draft.competitorResearch.competitors.map((competitor, index) => <div key={index} className="rounded-lg border border-slate-200 p-4"><h4 className="text-xs font-extrabold text-navy">{competitor.name || `Competitor ${index + 1}`}</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><Detail label="Product URL" value={competitor.productUrl} /><Detail label="Price" value={competitor.price} /><Detail label="Key features" value={competitor.keyFeatures} /><Detail label="Advantages" value={competitor.advantages} /><Detail label="Disadvantages" value={competitor.disadvantages} /><Detail label="Notes" value={competitor.notes} /></div></div>)}</div><div className="mt-3"><EvidenceList evidence={draft.competitorResearch.evidence} /></div></section>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Customer Research</h3><div className="grid gap-3 sm:grid-cols-2"><Detail label="Positive themes" value={draft.customerResearch.positiveThemes} /><Detail label="Negative themes" value={draft.customerResearch.negativeThemes} /><Detail label="Common complaints" value={draft.customerResearch.complaints} /><Detail label="Common praises" value={draft.customerResearch.praises} /><Detail label="Other observations" value={draft.customerResearch.observations} /></div><div className="mt-3"><EvidenceList evidence={draft.customerResearch.evidence} /></div></section>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Market/Trend Research</h3><div className="grid gap-3 sm:grid-cols-2"><Detail label="Relevant trends" value={draft.marketTrends.trends} /><Detail label="Emerging patterns" value={draft.marketTrends.patterns} /><Detail label="Opportunities" value={draft.marketTrends.opportunities} /><Detail label="Risks" value={draft.marketTrends.risks} /></div><div className="mt-3"><EvidenceList evidence={draft.marketTrends.evidence} /></div></section>
      <section><h3 className="mb-3 text-sm font-extrabold text-navy">Final Analysis</h3><div className="grid gap-3 sm:grid-cols-2"><Detail label="Key findings" value={draft.finalAnalysis.keyFindings} /><Detail label="Overall assessment" value={draft.finalAnalysis.overallAssessment} /><Detail label="Recommendations" value={draft.finalAnalysis.recommendations} /><Detail label="Additional notes" value={draft.finalAnalysis.additionalNotes} /></div><div className="mt-3"><EvidenceList evidence={draft.finalAnalysis.evidence} /></div></section>
      <section className="border-t border-slate-200 pt-5"><h3 className="text-sm font-extrabold text-navy">Admin decision</h3>{task.status === "Completed" || task.status === "Changes Requested" ? <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">This submission was already reviewed: {task.status}{task.changeRequest ? ` — ${task.changeRequest}` : ""}.</p> : <><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setDecision("Approved")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-extrabold ${decision === "Approved" ? "bg-emerald-600 text-white" : "border border-slate-200 text-slate-700 hover:border-emerald-400"}`}><Check size={14} />Approve</button><button type="button" onClick={() => setDecision("Changes Requested")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-extrabold ${decision === "Changes Requested" ? "bg-amber-500 text-navy" : "border border-slate-200 text-slate-700 hover:border-amber-400"}`}><RefreshCw size={14} />Request Changes</button></div>{decision === "Changes Requested" && <label className="mt-4 block text-xs font-bold text-slate-700">Reason for requested changes <span className="text-red-600">*</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={4} required className="mt-1.5 w-full rounded-lg border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-orange" placeholder="Explain what the contributor should revise." /></label>}<button type="button" onClick={() => void submitDecision()} disabled={!decision || working || decision === "Changes Requested" && !message.trim()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-navy px-5 py-2.5 text-xs font-extrabold text-white disabled:opacity-50">{working ? "Saving…" : "Save Review"}<ArrowRight size={14} /></button></>}</section>
    </>}</div></section></div>;
}

export default function AdminResearchTasks() {
  const [tasks, setTasks] = useState<AdminResearchTask[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [productName, setProductName] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<AdminResearchReviewTask | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const { tasks: loaded } = await listAdminResearchTasks();
      setTasks(loaded);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load assignments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([listAdminResearchTasks(), listAdminUsers("")]).then(([taskResult, userResult]) => {
      if (!active) return;
      setTasks(taskResult.tasks);
      setUsers(userResult.users.filter((user) => !user.isAdmin && user.status === "Active"));
      setError("");
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load assignments."); }).finally(() => { if (active) setLoading(false); });
    const timer = window.setInterval(() => { void load(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [load]);

  const createTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedUser || !productName.trim() || working) return;
    setWorking(true);
    try {
      await createAdminResearchTask(selectedUser, productName.trim());
      setProductName("");
      toast.success("Product Research assigned.");
      await load();
    } catch (createError) {
      toast.error(createError instanceof Error ? createError.message : "Unable to assign Product Research.");
    } finally {
      setWorking(false);
    }
  };

  const openReview = async (task: AdminResearchTask) => {
    try {
      const detail = await getAdminResearchTask(task.id);
      setSelectedTask({ ...task, ...detail });
      await load();
    } catch (reviewError) {
      toast.error(reviewError instanceof Error ? reviewError.message : "Unable to load this submission.");
    }
  };

  const taskFiltered = tasks.filter((task) => `${task.contributor} ${task.productName ?? ""} ${task.status}`.toLowerCase().includes(search.toLowerCase()));

  return <div className="space-y-7">
    <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Assignment operations</p><h2 className="mt-2 text-[32px] font-extrabold tracking-[-0.04em] text-navy sm:text-[40px]">Product Research</h2><p className="mt-3 max-w-[650px] text-sm leading-6 text-slate-500">Assign research work, monitor progress, and review submitted work. Assignment rewards are informational and do not change contributor balances.</p></div>
    <form onSubmit={(event) => void createTask(event)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-center gap-2"><UserPlus size={17} className="text-orange" /><h3 className="text-sm font-extrabold text-navy">Assign a Product Research task</h3></div><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-bold text-slate-700">Contributor<select value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} required className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-orange"><option value="">Select contributor</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label><label className="text-xs font-bold text-slate-700">Product being researched<input value={productName} onChange={(event) => setProductName(event.target.value)} required maxLength={200} placeholder="e.g. Product name or model" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm outline-none focus:border-orange" /></label><button type="submit" disabled={working || users.length === 0} className="self-end inline-flex items-center justify-center gap-2 rounded-lg bg-orange px-4 py-3 text-xs font-extrabold text-navy hover:bg-orange-light disabled:opacity-50"><Send size={14} />{working ? "Assigning…" : "Assign Task"}</button></div>{users.length === 0 && <p className="mt-3 text-xs text-slate-500">No active contributor accounts are available to assign.</p>}</form>
    <section className="rounded-xl border border-slate-200 bg-white shadow-card"><div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-extrabold text-navy">Assignment progress</h3><p className="mt-1 text-xs text-slate-500">Refreshes automatically every 10 seconds.</p></div><div className="flex gap-2"><label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input aria-label="Filter assignments" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assignments" className="w-56 rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-orange" /></label><button type="button" onClick={() => void load()} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:border-orange hover:text-navy" aria-label="Refresh assignments"><RefreshCw size={15} /></button></div></div>
      {error && <p className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}{loading ? <p className="p-8 text-center text-sm text-slate-500">Loading assignments…</p> : taskFiltered.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No Product Research assignments found.</p> : <div className="divide-y divide-slate-100">{taskFiltered.map((task) => <article key={task.id} className="grid gap-3 p-5 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-center"><div><p className="text-sm font-extrabold text-navy">{task.contributor} <span className="font-medium text-slate-500">— Product Research</span></p><p className="mt-1 text-xs text-slate-500">{task.productName || "Product not specified"}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</p><p className="mt-1 text-xs font-bold text-navy">{task.status}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Progress · Current step</p><p className="mt-1 text-xs font-bold text-navy">{task.progress}% · {PRODUCT_RESEARCH_TEMPLATE.sections.find((section) => section.id === task.currentStep)?.title ?? task.currentStep}</p><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange" style={{ width: `${task.progress}%` }} /></div></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Assigned / started · Last activity</p><p className="mt-1 text-xs text-slate-600">{task.status === "Available" ? "Not accepted yet" : when(task.startedAt)} · {when(task.lastActivityAt)}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => void openReview(task)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold text-navy hover:border-orange">{["Submitted", "Under Review", "Changes Requested", "Completed"].includes(task.status) ? "Review" : "Details"}<ArrowRight size={13} /></button>{task.submittedAt && <span title={`Submitted ${new Date(task.submittedAt).toLocaleString()}`} className="inline-flex items-center gap-1 text-[10px] text-slate-500"><Clock3 size={12} />Submitted</span>}</div></article>)}</div>}
    </section>
    {selectedTask && <SubmissionReview task={selectedTask} onClose={() => setSelectedTask(null)} onReviewed={() => { setSelectedTask(null); void load(); }} />}
  </div>;
}
