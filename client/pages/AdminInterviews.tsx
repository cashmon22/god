import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, CircleAlert, LoaderCircle, Plus, Save, Trash2, UserRound, X } from "lucide-react";
import {
  createInterviewQuestion,
  deleteInterviewQuestion,
  getInterviewQuestions,
  listAdminInterviews,
  reorderInterviewQuestions,
  updateInterviewQuestion,
  updateInterviewStatus,
  type InterviewQuestion,
  type InterviewSubmission,
} from "@/lib/interviews";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AdminInterviews() {
  const [searchParams] = useSearchParams();
  const pendingOnly = searchParams.get("status") === "Under Review";
  const [tab, setTab] = useState<"submissions" | "questions">("submissions");
  const [submissions, setSubmissions] = useState<InterviewSubmission[]>([]);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [selected, setSelected] = useState<InterviewSubmission | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newQuestion, setNewQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const visibleSubmissions = pendingOnly ? submissions.filter((submission) => submission.status === "Under Review") : submissions;

  useEffect(() => {
    let active = true;
    Promise.all([listAdminInterviews(), getInterviewQuestions()]).then(([submissionResult, questionResult]) => {
      if (!active) return;
      setSubmissions(submissionResult.submissions);
      setQuestions(questionResult.questions);
      setDrafts(Object.fromEntries(questionResult.questions.map((question) => [question.id, question.prompt])));
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load interview management.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  const saveDecision = async (status: "Approved" | "Rejected") => {
    if (!selected || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      await updateInterviewStatus(selected.id, status);
      const updated = { ...selected, status };
      setSelected(updated);
      setSubmissions((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast.success(`Applicant ${status === "Approved" ? "accepted" : "rejected"}.`);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Unable to update applicant status.");
      toast.error("Unable to update applicant status.");
    } finally {
      setIsSaving(false);
    }
  };

  const addQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const { question } = await createInterviewQuestion(newQuestion);
      const updated = [...questions, question].sort((a, b) => a.position - b.position);
      setQuestions(updated);
      setDrafts((current) => ({ ...current, [question.id]: question.prompt }));
      setNewQuestion("");
      toast.success("Interview question added.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to add question.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveQuestion = async (question: InterviewQuestion) => {
    const prompt = drafts[question.id]?.trim() ?? "";
    if (isSaving || prompt === question.prompt) return;
    setIsSaving(true);
    setError("");
    try {
      const { question: updated } = await updateInterviewQuestion(question.id, prompt);
      setQuestions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDrafts((current) => ({ ...current, [updated.id]: updated.prompt }));
      toast.success("Interview question updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update question.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeQuestion = async (question: InterviewQuestion) => {
    if (isSaving || !window.confirm("Remove this question from future interviews?")) return;
    setIsSaving(true);
    setError("");
    try {
      await deleteInterviewQuestion(question.id);
      setQuestions((current) => current.filter((item) => item.id !== question.id));
      setDrafts((current) => { const next = { ...current }; delete next[question.id]; return next; });
      toast.success("Question removed.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to remove question.");
    } finally {
      setIsSaving(false);
    }
  };

  const moveQuestion = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (isSaving || target < 0 || target >= questions.length) return;
    const reordered = [...questions];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setQuestions(reordered);
    setIsSaving(true);
    setError("");
    try {
      await reorderInterviewQuestions(reordered.map((question) => question.id));
      setQuestions(reordered.map((question, position) => ({ ...question, position })));
    } catch (saveError) {
      setQuestions(questions);
      setError(saveError instanceof Error ? saveError.message : "Unable to reorder questions.");
    } finally {
      setIsSaving(false);
    }
  };

  return <div>
    <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Onboarding</p><h2 className="mt-2 text-[32px] font-extrabold tracking-[-0.04em] text-navy sm:text-[40px]">Interview Management</h2><p className="mt-3 max-w-[650px] text-sm leading-6 text-slate-500">Review applicant responses and manage the questions shown to future applicants.</p></div>
    <div className="mt-7 flex gap-2 border-b border-slate-200"><button type="button" onClick={() => setTab("submissions")} className={`border-b-2 px-4 py-3 text-xs font-bold ${tab === "submissions" ? "border-orange text-navy" : "border-transparent text-slate-500"}`}>{pendingOnly ? `Pending interviews (${visibleSubmissions.length})` : `Submitted interviews (${submissions.length})`}</button><button type="button" onClick={() => setTab("questions")} className={`border-b-2 px-4 py-3 text-xs font-bold ${tab === "questions" ? "border-orange text-navy" : "border-transparent text-slate-500"}`}>Interview questions ({questions.length})</button></div>
    {pendingOnly && <Link to="/admin/interviews" className="mt-4 inline-flex rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-orange/50 hover:text-navy">Show all interviews</Link>}
    {error && <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><CircleAlert size={16} className="mt-0.5" />{error}</div>}
    {isLoading ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500"><LoaderCircle size={17} className="animate-spin text-orange" /> Loading interview management…</div> : tab === "submissions" ? <div className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_3px_16px_rgba(20,36,52,0.04)]"><div className="border-b border-slate-100 px-5 py-4"><h3 className="text-sm font-extrabold text-navy">{pendingOnly ? "Pending applicant queue" : "Applicant queue"}</h3><p className="mt-1 text-xs text-slate-500">Select an applicant to review answers.</p></div>{visibleSubmissions.length ? <div className="divide-y divide-slate-100">{visibleSubmissions.map((submission) => <button key={submission.id} type="button" onClick={() => setSelected(submission)} className={`block w-full px-5 py-4 text-left transition hover:bg-[#fbfcfd] ${selected?.id === submission.id ? "bg-orange/[0.06]" : ""}`}><div className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm font-bold text-navy">{submission.applicant_name}</span><span className="mt-1 block truncate text-xs text-slate-500">{submission.email}</span><span className="mt-1 block text-[10px] font-semibold text-slate-400">{submission.interview_mode === "text" ? "Text-Based Interview" : submission.interview_mode === "video" ? "Video Interview" : "Format not recorded"}</span></span><span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold ${submission.status === "Approved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : submission.status === "Rejected" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{submission.status}</span></div><span className="mt-2 block text-[10px] text-slate-400">Submitted {dateLabel(submission.submitted_at)}</span></button>)}</div> : <div className="px-5 py-12 text-center text-sm text-slate-500">{pendingOnly ? "No pending interviews." : "No interviews have been submitted yet."}</div>}</section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-6">{selected ? <><div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><UserRound size={17} className="text-orange" /><h3 className="text-lg font-extrabold text-navy">{selected.applicant_name}</h3></div><p className="mt-2 text-xs text-slate-500">{selected.email}</p><p className="mt-1 text-xs font-semibold text-slate-600">{selected.interview_mode === "text" ? "Text-Based Interview" : selected.interview_mode === "video" ? "Video Interview" : "Format not recorded"}</p><p className="mt-1 text-[10px] text-slate-400">Submitted {dateLabel(selected.submitted_at)}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">{selected.status}</span></div><div className="mt-5 space-y-5">{selected.answers.map((answer, index) => <div key={answer.questionId}><p className="text-[10px] font-bold uppercase tracking-wide text-orange">Question {index + 1}</p><h4 className="mt-1 text-sm font-bold leading-5 text-navy">{answer.question}</h4><p className="mt-2 whitespace-pre-wrap rounded-md bg-[#fbfcfd] p-3 text-sm leading-6 text-slate-600">{answer.answer}</p></div>)}</div><div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-5"><button type="button" disabled={isSaving || selected.status === "Approved"} onClick={() => void saveDecision("Approved")} className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"><Check size={14} /> Accept applicant</button><button type="button" disabled={isSaving || selected.status === "Rejected"} onClick={() => void saveDecision("Rejected")} className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-4 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50"><X size={14} /> Reject applicant</button></div></> : <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-400"><UserRound size={25} /><p className="mt-3 text-sm font-semibold">Choose an interview to review</p></div>}</section>
    </div> : <div className="mt-6 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-6"><div className="mb-5"><h3 className="text-sm font-extrabold text-navy">Questions for future applicants</h3><p className="mt-1 text-xs text-slate-500">Changes apply to interviews submitted after the update.</p></div>{questions.length ? <div className="space-y-3">{questions.map((question, index) => <div key={question.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-start"><div className="flex min-w-0 flex-1 gap-3"><span className="mt-2 text-xs font-bold text-slate-400">{index + 1}.</span><textarea rows={2} maxLength={1000} value={drafts[question.id] ?? question.prompt} onChange={(event) => setDrafts((current) => ({ ...current, [question.id]: event.target.value }))} className="w-full resize-y rounded-md border border-slate-200 bg-[#fbfcfd] p-2.5 text-sm text-navy outline-none focus:border-orange" /></div><div className="flex shrink-0 items-center gap-1"><button type="button" title="Move up" aria-label={`Move question ${index + 1} up`} disabled={isSaving || index === 0} onClick={() => void moveQuestion(index, -1)} className="rounded-md border border-slate-200 p-2 text-slate-500 disabled:opacity-30"><ArrowUp size={14} /></button><button type="button" title="Move down" aria-label={`Move question ${index + 1} down`} disabled={isSaving || index === questions.length - 1} onClick={() => void moveQuestion(index, 1)} className="rounded-md border border-slate-200 p-2 text-slate-500 disabled:opacity-30"><ArrowDown size={14} /></button><button type="button" onClick={() => void saveQuestion(question)} disabled={isSaving || !(drafts[question.id] ?? "").trim() || drafts[question.id] === question.prompt} className="rounded-md border border-slate-200 p-2 text-navy disabled:opacity-30" aria-label="Save question"><Save size={14} /></button><button type="button" onClick={() => void removeQuestion(question)} disabled={isSaving} className="rounded-md border border-red-200 p-2 text-red-600 disabled:opacity-40" aria-label="Remove question"><Trash2 size={14} /></button></div></div>)}</div> : <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No interview questions. Add a question below to reopen interview submissions.</p>}</section>
      <form onSubmit={addQuestion} className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_3px_16px_rgba(20,36,52,0.04)] sm:p-6"><h3 className="text-sm font-extrabold text-navy">Add a question</h3><div className="mt-4 flex flex-col gap-3 sm:flex-row"><textarea required minLength={5} maxLength={1000} rows={2} value={newQuestion} onChange={(event) => setNewQuestion(event.target.value)} placeholder="Enter the question for future applicants" className="min-w-0 flex-1 rounded-md border border-slate-200 bg-[#fbfcfd] p-3 text-sm text-navy outline-none focus:border-orange" /><button type="submit" disabled={isSaving || newQuestion.trim().length < 5} className="inline-flex items-center justify-center gap-2 rounded-md bg-orange px-5 py-3 text-xs font-extrabold text-navy disabled:opacity-50"><Plus size={15} /> Add question</button></div></form>
    </div>}
  </div>;
}
