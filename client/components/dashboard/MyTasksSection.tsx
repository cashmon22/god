import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ClipboardList, Clock3, DollarSign } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { listContributorTasks, type ContributorTask } from "@/lib/contributor-tasks";
import { acceptResearchTask, listResearchTasks } from "@/lib/research-tasks";
import type { ProductResearchTask } from "@shared/product-research";

export default function MyTasksSection({ onOpenResearchTask }: { onOpenResearchTask: (taskId: string) => void }) {
  const [tasks, setTasks] = useState<ContributorTask[]>([]);
  const [researchTasks, setResearchTasks] = useState<ProductResearchTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptingId, setAcceptingId] = useState("");

  const loadTasks = useCallback(async () => {
    const [legacy, research] = await Promise.allSettled([listContributorTasks(), listResearchTasks()]);
    if (legacy.status === "fulfilled") {
      setTasks(legacy.value.tasks);
      setError("");
    } else {
      setError(legacy.reason instanceof Error ? legacy.reason.message : "Unable to load your tasks.");
    }
    if (research.status === "fulfilled") setResearchTasks(research.value.tasks);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => { void loadTasks(); }, 15000);
    return () => window.clearInterval(timer);
  }, [loadTasks]);

  const handleAccept = async (task: ProductResearchTask) => {
    setAcceptingId(task.id);
    try {
      await acceptResearchTask(task.id);
      onOpenResearchTask(task.id);
    } catch (acceptError) {
      toast.error(acceptError instanceof Error ? acceptError.message : "Unable to accept this assignment.");
      await loadTasks();
    } finally {
      setAcceptingId("");
    }
  };

  const legacyTasks = tasks.filter((task) => task.assignment.category !== "Product Research" || !researchTasks.some((research) => research.id === task.id));
  const hasTasks = legacyTasks.length > 0 || researchTasks.length > 0;

  return <div>
    <div className="border-b border-slate-200 pb-6"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Contributor workspace</p><h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.04em] text-navy sm:text-[32px]">My Tasks</h1><p className="mt-2 max-w-[600px] text-sm leading-6 text-slate-500">Track assignments you&apos;ve started and their current progress.</p></div>
    {isLoading ? <div className="mt-8 grid gap-4 md:grid-cols-2" role="status" aria-label="Loading tasks">{[0, 1].map((item) => <div key={item} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-5 w-3/4" /><Skeleton className="mt-3 h-3 w-full" /><Skeleton className="mt-2 h-3 w-2/3" /></div>)}</div> : !hasTasks ? <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16 text-center shadow-card"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400"><ClipboardList size={26} /></span><p className="mt-5 text-sm font-extrabold text-navy">No active tasks</p><p className="mx-auto mt-2 max-w-[320px] text-xs leading-5 text-slate-500">You haven&apos;t started any assignments yet. Browse Assignments to find available tasks.</p></div> : <div className="mt-8 grid gap-4 md:grid-cols-2">
      {researchTasks.map((task) => <article key={task.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-start justify-between gap-3"><span className="rounded-md bg-orange/10 px-2.5 py-1 text-[10px] font-extrabold text-orange">Product Research</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${task.status === "Changes Requested" ? "bg-amber-50 text-amber-700" : task.status === "Completed" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{task.status}</span></div><h2 className="mt-4 text-sm font-extrabold text-navy">Product Research</h2><p className="mt-2 text-xs leading-5 text-slate-500">{task.productName ? `Research ${task.productName} and record sourced findings.` : "A contributor assignment for structured product and market research."}</p><div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><Clock3 size={13} className="text-slate-400" />30–90 min</span><span className="flex items-center gap-1.5"><DollarSign size={13} className="text-emerald-500" />${task.rewardMin ?? 20}–${task.rewardMax ?? 100}</span><span>{task.acceptedAt ? "Accepted" : task.status === "Available" ? "Assigned" : "Started"} {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(task.acceptedAt ?? task.createdAt))}</span></div>{task.status !== "Available" && task.status !== "Completed" && <div className="mt-4"><div className="flex justify-between text-[10px] font-bold text-slate-500"><span>Progress</span><span>{task.progress}%</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange" style={{ width: `${task.progress}%` }} /></div></div>}<button type="button" disabled={acceptingId === task.id} onClick={() => task.status === "Available" ? void handleAccept(task) : onOpenResearchTask(task.id)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-xs font-extrabold text-white transition hover:bg-[#1d3042] disabled:opacity-60">{acceptingId === task.id ? "Accepting…" : task.status === "Available" ? "Accept Assignment" : task.status === "Changes Requested" ? "Revise Assignment" : task.status === "Completed" ? "View Assignment" : task.status === "Submitted" || task.status === "Under Review" ? "View Submission" : "Open Workspace"}<ArrowRight size={14} /></button></article>)}
      {legacyTasks.map((task) => <article key={task.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"><div className="flex items-start justify-between gap-3"><span className="rounded-md bg-orange/10 px-2.5 py-1 text-[10px] font-extrabold text-orange">{task.assignment.category}</span><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{task.status}</span></div><h2 className="mt-4 text-sm font-extrabold text-navy">{task.assignment.title}</h2><p className="mt-2 text-xs leading-5 text-slate-500">{task.assignment.description}</p><div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><Clock3 size={13} className="text-slate-400" />{task.assignment.estimatedTime}</span><span className="flex items-center gap-1.5"><DollarSign size={13} className="text-emerald-500" />${task.assignment.reward.toFixed(2)}</span><span>Started {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(task.createdAt))}</span></div></article>)}
    </div>}
    {error && !legacyTasks.length && <p className="mt-4 text-xs text-amber-700">Some assignment records could not be loaded. Refresh to try again.</p>}
  </div>;
}
