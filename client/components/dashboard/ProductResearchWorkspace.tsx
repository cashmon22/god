import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, Cloud, FileUp, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PRODUCT_RESEARCH_TEMPLATE, type ProductResearchDraft, type ProductResearchEvidence, type ProductResearchSectionId } from "@shared/product-research";
import { getResearchTask, saveResearchTask, submitResearchTask } from "@/lib/research-tasks";
import { supabase } from "@/lib/supabase";

type ResearchTask = Awaited<ReturnType<typeof getResearchTask>>;

function emptyEvidence(): ProductResearchEvidence {
  return { sourceUrl: "", notes: "" };
}

function emptyDraft(productName = ""): ProductResearchDraft {
  return {
    productInformation: { productName, sourceUrl: "", category: "", price: "", rating: "", otherInformation: "", evidence: [emptyEvidence()] },
    productFeatures: { mainFeatures: "", benefits: "", strengths: "", weaknesses: "", observations: "", evidence: [emptyEvidence()] },
    competitorResearch: { competitors: [{ name: "", productUrl: "", price: "", keyFeatures: "", advantages: "", disadvantages: "", notes: "" }], evidence: [emptyEvidence()] },
    customerResearch: { positiveThemes: "", negativeThemes: "", complaints: "", praises: "", observations: "", evidence: [emptyEvidence()] },
    marketTrends: { trends: "", patterns: "", opportunities: "", risks: "", evidence: [emptyEvidence()] },
    finalAnalysis: { keyFindings: "", overallAssessment: "", recommendations: "", additionalNotes: "", evidence: [emptyEvidence()] },
  };
}

const sectionKeys: Record<string, keyof ProductResearchDraft> = {
  "product-information": "productInformation",
  "product-features": "productFeatures",
  "competitor-research": "competitorResearch",
  "customer-research": "customerResearch",
  "market-trends": "marketTrends",
  "final-analysis": "finalAnalysis",
};

const WorkspaceEditableContext = createContext(true);

function Field({ label, value, onChange, placeholder, type = "textarea", required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: "textarea" | "input" | "url" | "number"; required?: boolean }) {
  const editable = useContext(WorkspaceEditableContext);
  const id = `research-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const className = "mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-navy outline-none transition placeholder:text-slate-400 focus:border-orange focus:ring-2 focus:ring-orange/15";
  return <label htmlFor={id} className="block text-xs font-bold text-slate-700">{label}{required && <span className="ml-1 text-orange">*</span>}{type === "textarea" ? <textarea id={id} value={value} placeholder={placeholder} rows={3} required={required} disabled={!editable} onChange={(event) => onChange(event.target.value)} className={`${className} resize-y disabled:bg-slate-50 disabled:text-slate-500`} /> : <input id={id} value={value} type={type === "input" ? "text" : type} placeholder={placeholder} required={required} disabled={!editable} onChange={(event) => onChange(event.target.value)} className={`${className} disabled:bg-slate-50 disabled:text-slate-500`} />}</label>;
}

export default function ProductResearchWorkspace({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [draft, setDraft] = useState<ProductResearchDraft>(emptyDraft());
  const [currentStep, setCurrentStep] = useState<ProductResearchSectionId>("product-information");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingKey, setUploadingKey] = useState("");
  const hydrated = useRef(false);
  const taskStatus = useRef<string | null>(null);
  const latest = useRef({ draft, currentStep });
  const editable = ["Accepted", "In Progress", "Changes Requested", "Started"].includes(task?.status ?? "");

  useEffect(() => { latest.current = { draft, currentStep }; }, [draft, currentStep]);
  useEffect(() => { taskStatus.current = task?.status ?? null; }, [task?.status]);
  useEffect(() => () => {
    if (hydrated.current && ["Accepted", "In Progress", "Changes Requested", "Started"].includes(taskStatus.current ?? "")) {
      void saveResearchTask(taskId, latest.current.draft, latest.current.currentStep);
    }
  }, [taskId]);

  useEffect(() => {
    let active = true;
    hydrated.current = false;
    setLoading(true);
    setLoadError("");
    void getResearchTask(taskId).then((loaded) => {
      if (!active) return;
      setTask(loaded);
      const base = emptyDraft(loaded.productName ?? "");
      const loadedDraft = loaded.draft as ProductResearchDraft;
      if (loadedDraft?.productInformation && loadedDraft?.finalAnalysis) {
        for (const key of Object.keys(base) as Array<keyof ProductResearchDraft>) {
          (base[key] as any) = { ...base[key], ...loadedDraft[key] };
        }
      }
      setDraft(base);
      const section = PRODUCT_RESEARCH_TEMPLATE.sections.find((item) => item.id === loaded.currentStep)?.id ?? "product-information";
      setCurrentStep(section);
      setLoading(false);
      window.setTimeout(() => { if (active) hydrated.current = true; }, 0);
    }).catch((error) => {
      if (active) {
        setLoadError(error instanceof Error ? error.message : "Unable to load this assignment.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [taskId]);

  const progress = useMemo(() => {
    const has = (value: string) => value.trim().length > 0;
    const complete = [
      has(draft.productInformation.productName) && has(draft.productInformation.sourceUrl) && has(draft.productInformation.category) && has(draft.productInformation.price),
      has(draft.productFeatures.mainFeatures) && has(draft.productFeatures.benefits) && has(draft.productFeatures.strengths) && has(draft.productFeatures.weaknesses),
      draft.competitorResearch.competitors.some((item) => has(item.name) && has(item.productUrl) && has(item.keyFeatures)),
      has(draft.customerResearch.positiveThemes) && has(draft.customerResearch.negativeThemes) && has(draft.customerResearch.complaints) && has(draft.customerResearch.praises),
      has(draft.marketTrends.trends) && has(draft.marketTrends.patterns) && has(draft.marketTrends.opportunities) && has(draft.marketTrends.risks),
      has(draft.finalAnalysis.keyFindings) && has(draft.finalAnalysis.overallAssessment) && has(draft.finalAnalysis.recommendations),
    ];
    const completed = complete.filter(Boolean).length;
    return { complete, completed, percent: Math.round(completed / 7 * 100), ready: completed === 6 };
  }, [draft]);

  const persist = async (value = latest.current) => {
    if (!editable) return;
    setSaveState("saving");
    try {
      const saved = await saveResearchTask(taskId, value.draft, value.currentStep);
      setTask(saved);
      setSaveState("saved");
      return true;
    } catch (error) {
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : "Unable to save your progress.");
      return false;
    }
  };

  useEffect(() => {
    if (!hydrated.current || !editable) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(() => { void persist({ draft, currentStep }); }, 900);
    return () => window.clearTimeout(timer);
  }, [draft, currentStep, editable]);

  useEffect(() => {
    let active = true;
    const refreshStatus = () => {
      void getResearchTask(taskId).then((updated) => {
        if (active) setTask((current) => current ? { ...current, status: updated.status, changeRequest: updated.changeRequest, progress: updated.progress, submittedAt: updated.submittedAt } : updated);
      }).catch(() => {});
    };
    const timer = window.setInterval(refreshStatus, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [taskId]);

  const updateSection = <K extends keyof ProductResearchDraft>(section: K, update: (value: ProductResearchDraft[K]) => ProductResearchDraft[K]) => {
    setDraft((current) => ({ ...current, [section]: update(current[section]) }));
  };

  const updateText = (sectionId: string, field: string, value: string) => {
    const key = sectionKeys[sectionId];
    if (!key) return;
    updateSection(key, (current) => ({ ...current, [field]: value } as ProductResearchDraft[typeof key]));
  };

  const updateEvidence = (sectionId: string, index: number, patch: Partial<ProductResearchEvidence>) => {
    const key = sectionKeys[sectionId];
    if (!key) return;
    updateSection(key, (current) => {
      const section = current as { evidence: ProductResearchEvidence[] };
      return { ...section, evidence: section.evidence.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } as ProductResearchDraft[typeof key];
    });
  };

  const addEvidence = (sectionId: string) => {
    const key = sectionKeys[sectionId];
    if (!key) return;
    updateSection(key, (current) => ({ ...current, evidence: [...(current as { evidence: ProductResearchEvidence[] }).evidence, emptyEvidence()] } as ProductResearchDraft[typeof key]));
  };

  const removeEvidence = async (sectionId: string, index: number) => {
    const key = sectionKeys[sectionId];
    if (!key) return;
    const evidence = (draft[key] as { evidence: ProductResearchEvidence[] }).evidence[index];
    if (evidence?.filePath) await supabase.storage.from("assignment-evidence").remove([evidence.filePath]);
    updateSection(key, (current) => ({ ...current, evidence: (current as { evidence: ProductResearchEvidence[] }).evidence.filter((_, itemIndex) => itemIndex !== index) } as ProductResearchDraft[typeof key]));
  };

  const uploadEvidence = async (sectionId: string, index: number, file?: File) => {
    if (!file) return;
    if (!PRODUCT_RESEARCH_TEMPLATE.evidence.acceptedTypes.includes(file.type as typeof PRODUCT_RESEARCH_TEMPLATE.evidence.acceptedTypes[number]) || file.size > PRODUCT_RESEARCH_TEMPLATE.evidence.maxFileSizeBytes) {
      toast.error("Choose a JPG, PNG, WebP, or PDF smaller than 8 MB.");
      return;
    }
    const key = sectionKeys[sectionId];
    if (!key) return;
    const evidence = (draft[key] as { evidence: ProductResearchEvidence[] }).evidence[index];
    if (evidence?.filePath) await supabase.storage.from("assignment-evidence").remove([evidence.filePath]);
    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    const filePath = `${taskId}/${crypto.randomUUID()}.${extension}`;
    setUploadingKey(`${sectionId}-${index}`);
    const { error } = await supabase.storage.from("assignment-evidence").upload(filePath, file, { upsert: false, contentType: file.type });
    setUploadingKey("");
    if (error) {
      toast.error("Unable to upload this file. Save your work and try again.");
      return;
    }
    updateEvidence(sectionId, index, { filePath, fileName: file.name.slice(0, 255), mimeType: file.type });
  };

  const changeStep = async (next: ProductResearchSectionId) => {
    setCurrentStep(next);
  };

  const handleManualSave = async () => {
    const saved = await persist(latest.current);
    if (saved) toast.success("Progress saved.");
  };

  const handleSubmit = async () => {
    if (!progress.ready || submitting) return;
    setSubmitting(true);
    try {
      const saved = await persist(latest.current);
      if (!saved) return;
      await submitResearchTask(taskId, latest.current.draft);
      const refreshed = await getResearchTask(taskId);
      setTask(refreshed);
      toast.success("Assignment submitted for review.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit this assignment.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading Product Research workspace…</div>;
  if (loadError || !task) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">{loadError || "Assignment not found."}<button onClick={onBack} className="ml-3 font-bold underline">Back to tasks</button></div>;

  const currentIndex = PRODUCT_RESEARCH_TEMPLATE.sections.findIndex((section) => section.id === currentStep);
  const currentSection = PRODUCT_RESEARCH_TEMPLATE.sections[currentIndex];
  const currentKey = sectionKeys[currentStep];
  const sectionValue = currentKey ? draft[currentKey] as Record<string, any> : null;
  const lockedStatus = task.status === "Submitted" || task.status === "Under Review" || task.status === "Completed";
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Unsaved changes";
  const displayedProgress = ["Submitted", "Under Review", "Completed"].includes(task?.status ?? "") ? 100 : progress.percent;
  const reviewSummaries = [
    `Name: ${draft.productInformation.productName}; URL: ${draft.productInformation.sourceUrl}; Category: ${draft.productInformation.category}; Price: ${draft.productInformation.price}; Rating: ${draft.productInformation.rating}; Other: ${draft.productInformation.otherInformation}`,
    `Features: ${draft.productFeatures.mainFeatures}; Benefits: ${draft.productFeatures.benefits}; Strengths: ${draft.productFeatures.strengths}; Weaknesses: ${draft.productFeatures.weaknesses}; Notes: ${draft.productFeatures.observations}`,
    draft.competitorResearch.competitors.map((competitor) => `${competitor.name}: ${competitor.productUrl}; ${competitor.price}; ${competitor.keyFeatures}; Advantages: ${competitor.advantages}; Disadvantages: ${competitor.disadvantages}; Notes: ${competitor.notes}`).filter(Boolean).join(" | "),
    `Positive themes: ${draft.customerResearch.positiveThemes}; Negative themes: ${draft.customerResearch.negativeThemes}; Complaints: ${draft.customerResearch.complaints}; Praises: ${draft.customerResearch.praises}; Notes: ${draft.customerResearch.observations}`,
    `Trends: ${draft.marketTrends.trends}; Patterns: ${draft.marketTrends.patterns}; Opportunities: ${draft.marketTrends.opportunities}; Risks: ${draft.marketTrends.risks}`,
    `Findings: ${draft.finalAnalysis.keyFindings}; Assessment: ${draft.finalAnalysis.overallAssessment}; Recommendations: ${draft.finalAnalysis.recommendations}; Notes: ${draft.finalAnalysis.additionalNotes}`,
  ];

  return <div className="space-y-6">
    <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 transition hover:text-navy"><ArrowLeft size={15} /> Back to My Tasks</button>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Product Research Workspace · v{task.templateVersion ?? PRODUCT_RESEARCH_TEMPLATE.version}</p><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">Product Research</h1><p className="mt-2 text-sm text-slate-600">Product: <span className="font-bold text-navy">{task.productName || draft.productInformation.productName || "Product details not provided"}</span></p><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1">{PRODUCT_RESEARCH_TEMPLATE.difficulty}</span><span className="rounded-full bg-slate-100 px-3 py-1">{PRODUCT_RESEARCH_TEMPLATE.estimatedTime}</span><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Reward ${PRODUCT_RESEARCH_TEMPLATE.rewardMin}–${PRODUCT_RESEARCH_TEMPLATE.rewardMax}</span><span className="rounded-full bg-orange/10 px-3 py-1 text-orange">{task.status}</span></div></div>
        <div className="min-w-[180px] rounded-lg border border-slate-100 bg-[#fbfcfd] p-4"><div className="flex items-center justify-between text-xs"><span className="font-bold text-slate-600">Progress</span><span className="font-extrabold text-navy">{displayedProgress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-orange transition-all" style={{ width: `${displayedProgress}%` }} /></div><p className="mt-2 text-[10px] text-slate-500">Current step: {PRODUCT_RESEARCH_TEMPLATE.sections.find((section) => section.id === currentStep)?.title}</p></div>
      </div>
      {task.changeRequest && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-extrabold">Changes requested by admin</p><p className="mt-1 leading-6">{task.changeRequest}</p></div>}
      {lockedStatus && <p className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{task.status === "Completed" ? "This assignment has been approved and completed." : `Your submission is locked while it is ${task.status.toLowerCase()}.`}</p>}
    </section>

    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav className="h-fit rounded-xl border border-slate-200 bg-white p-3 shadow-card" aria-label="Product Research steps">
        {PRODUCT_RESEARCH_TEMPLATE.sections.map((section, index) => <button key={section.id} type="button" onClick={() => void changeStep(section.id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition ${currentStep === section.id ? "bg-orange/10 text-orange" : "text-slate-600 hover:bg-slate-50"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${currentStep === section.id ? "bg-orange text-navy" : index < progress.completed ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{index < 6 && progress.complete[index] ? <Check size={14} /> : index + 1}</span><span className="text-xs font-bold">{section.title}</span></button>)}
        <div className="mt-3 border-t border-slate-100 pt-3"><p className="flex items-start gap-2 px-2 text-[10px] leading-4 text-slate-500"><CircleHelp size={13} className="mt-0.5 shrink-0" />Use reliable external sources and distinguish findings from your own analysis. Evidence is optional unless marked required.</p></div>
      </nav>

      <WorkspaceEditableContext.Provider value={editable}><section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-card sm:p-7">
        {currentStep === "submit-assignment" ? <>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">Final step · review</p><h2 className="mt-2 text-xl font-extrabold text-navy">Review your answers</h2><p className="mt-2 text-sm leading-6 text-slate-500">Check each section before submitting. Once submitted, editing is locked unless changes are requested.</p>
          <div className="mt-5 space-y-3">{PRODUCT_RESEARCH_TEMPLATE.sections.slice(0, 6).map((section, index) => <button key={section.id} type="button" onClick={() => void changeStep(section.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-4 text-left hover:border-orange/50"><span><span className="block text-xs font-extrabold text-navy">{section.title}</span><span className="mt-1 block max-h-20 overflow-y-auto whitespace-pre-wrap text-[10px] leading-4 text-slate-500">{progress.complete[index] ? reviewSummaries[index] || "Required information entered" : "Required information incomplete"}</span></span><ArrowRight size={15} className="text-orange" /></button>)}</div>
          {editable && <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">{progress.completed} of 6 required research sections complete.</p><button type="button" onClick={() => void handleSubmit()} disabled={!progress.ready || submitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange px-5 py-3 text-xs font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Submit Assignment</button></div>}
          {!progress.ready && <p className="mt-3 text-xs text-amber-700">Complete all required sections before the submit button is enabled.</p>}
        </> : <>
          <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-start"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange">Step {currentIndex + 1} of 7</p><h2 className="mt-1 text-xl font-extrabold text-navy">{currentSection.title}</h2></div>{editable && <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${saveState === "error" ? "text-red-600" : saveState === "saved" ? "text-emerald-700" : "text-slate-500"}`}><Cloud size={13} />{saveLabel}</span>}</div>
          {currentKey && sectionValue && <div className="mt-5 space-y-4">
            {currentStep === "product-information" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Product name" value={sectionValue.productName} required type="input" onChange={(value) => updateText(currentStep, "productName", value)} /><Field label="Product URL / source" value={sectionValue.sourceUrl} required type="url" placeholder="https://" onChange={(value) => updateText(currentStep, "sourceUrl", value)} /><Field label="Category" value={sectionValue.category} required type="input" onChange={(value) => updateText(currentStep, "category", value)} /><Field label="Price" value={sectionValue.price} required type="input" placeholder="Include currency" onChange={(value) => updateText(currentStep, "price", value)} /><Field label="Rating" value={sectionValue.rating} type="input" onChange={(value) => updateText(currentStep, "rating", value)} /><Field label="Other relevant information" value={sectionValue.otherInformation} onChange={(value) => updateText(currentStep, "otherInformation", value)} /></div>}
            {currentStep === "product-features" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Main features" value={sectionValue.mainFeatures} required onChange={(value) => updateText(currentStep, "mainFeatures", value)} /><Field label="Benefits" value={sectionValue.benefits} required onChange={(value) => updateText(currentStep, "benefits", value)} /><Field label="Strengths" value={sectionValue.strengths} required onChange={(value) => updateText(currentStep, "strengths", value)} /><Field label="Weaknesses" value={sectionValue.weaknesses} required onChange={(value) => updateText(currentStep, "weaknesses", value)} /><Field label="Other observations" value={sectionValue.observations} onChange={(value) => updateText(currentStep, "observations", value)} /></div>}
            {currentStep === "competitor-research" && <div className="space-y-4">{sectionValue.competitors.map((competitor: ProductResearchDraft["competitorResearch"]["competitors"][number], index: number) => <fieldset key={index} className="rounded-lg border border-slate-200 p-4"><legend className="px-2 text-xs font-extrabold text-navy">Competitor {index + 1}</legend><div className="grid gap-4 sm:grid-cols-2"><Field label="Competitor name" value={competitor.name} required onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, name: value } : item) }))} /><Field label="Product URL / source" value={competitor.productUrl} required type="url" onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, productUrl: value } : item) }))} /><Field label="Price" value={competitor.price} type="input" onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, price: value } : item) }))} /><Field label="Key features" value={competitor.keyFeatures} required onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, keyFeatures: value } : item) }))} /><Field label="Advantages" value={competitor.advantages} onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, advantages: value } : item) }))} /><Field label="Disadvantages" value={competitor.disadvantages} onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, disadvantages: value } : item) }))} /><Field label="Notes" value={competitor.notes} onChange={(value) => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, notes: value } : item) }))} /></div>{sectionValue.competitors.length > 1 && editable && <button type="button" onClick={() => updateSection("competitorResearch", (current) => ({ ...current, competitors: current.competitors.filter((_, itemIndex) => itemIndex !== index) }))} className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold text-red-600"><Trash2 size={12} />Remove competitor</button>}</fieldset>)}{editable && <button type="button" onClick={() => updateSection("competitorResearch", (current) => ({ ...current, competitors: [...current.competitors, { name: "", productUrl: "", price: "", keyFeatures: "", advantages: "", disadvantages: "", notes: "" }] }))} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-navy hover:border-orange"><Plus size={14} />Add competitor</button>}</div>}
            {currentStep === "customer-research" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Positive customer themes" value={sectionValue.positiveThemes} required onChange={(value) => updateText(currentStep, "positiveThemes", value)} /><Field label="Negative customer themes" value={sectionValue.negativeThemes} required onChange={(value) => updateText(currentStep, "negativeThemes", value)} /><Field label="Common complaints" value={sectionValue.complaints} required onChange={(value) => updateText(currentStep, "complaints", value)} /><Field label="Common praises" value={sectionValue.praises} required onChange={(value) => updateText(currentStep, "praises", value)} /><Field label="Other observations" value={sectionValue.observations} onChange={(value) => updateText(currentStep, "observations", value)} /></div>}
            {currentStep === "market-trends" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Relevant market trends" value={sectionValue.trends} required onChange={(value) => updateText(currentStep, "trends", value)} /><Field label="Emerging patterns" value={sectionValue.patterns} required onChange={(value) => updateText(currentStep, "patterns", value)} /><Field label="Opportunities" value={sectionValue.opportunities} required onChange={(value) => updateText(currentStep, "opportunities", value)} /><Field label="Risks" value={sectionValue.risks} required onChange={(value) => updateText(currentStep, "risks", value)} /></div>}
            {currentStep === "final-analysis" && <><div className="mb-4 rounded-lg bg-blue-50 p-4 text-xs leading-5 text-blue-900">Separate your own assessment and recommendations from external source material. Cite sources in the evidence area below.</div><div className="grid gap-4 sm:grid-cols-2"><Field label="Key findings" value={sectionValue.keyFindings} required onChange={(value) => updateText(currentStep, "keyFindings", value)} /><Field label="Overall assessment" value={sectionValue.overallAssessment} required onChange={(value) => updateText(currentStep, "overallAssessment", value)} /><Field label="Recommendations" value={sectionValue.recommendations} required onChange={(value) => updateText(currentStep, "recommendations", value)} /><Field label="Additional notes" value={sectionValue.additionalNotes} onChange={(value) => updateText(currentStep, "additionalNotes", value)} /></div></>}
          </div>}

          {currentKey && sectionValue && <div className="mt-7 border-t border-slate-100 pt-5"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h3 className="text-sm font-extrabold text-navy">Evidence & external sources</h3><p className="mt-1 text-xs text-slate-500">Optional unless the assignment instructions say otherwise. Attach source URLs, notes, images, or documents.</p></div>{editable && <button type="button" onClick={() => addEvidence(currentStep)} className="inline-flex items-center gap-1.5 text-xs font-bold text-orange hover:text-navy"><Plus size={14} />Add source</button>}</div><div className="mt-4 space-y-3">{sectionValue.evidence.map((evidence: ProductResearchEvidence, index: number) => <div key={index} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><Field label="Source URL" type="url" value={evidence.sourceUrl} onChange={(value) => updateEvidence(currentStep, index, { sourceUrl: value })} /><Field label="Evidence notes" value={evidence.notes} onChange={(value) => updateEvidence(currentStep, index, { notes: value })} /><div className="flex items-center gap-2">{editable && <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2.5 text-[10px] font-bold text-navy hover:border-orange"><FileUp size={14} />{uploadingKey === `${currentStep}-${index}` ? "Uploading" : evidence.fileName ? "Replace file" : "Attach file"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={uploadingKey !== ""} onChange={(event) => void uploadEvidence(currentStep, index, event.target.files?.[0])} /></label>}{editable && sectionValue.evidence.length > 1 && <button type="button" aria-label="Remove evidence source" onClick={() => void removeEvidence(currentStep, index)} className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>}</div>{evidence.fileName && <p className="text-[10px] text-emerald-700 sm:col-span-3">Attached: {evidence.fileName}</p>}</div>)}</div></div>}
        </>}

        {currentStep !== "submit-assignment" && <div className="mt-7 flex flex-col-reverse justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center"><button type="button" onClick={() => void changeStep(PRODUCT_RESEARCH_TEMPLATE.sections[Math.max(0, currentIndex - 1)].id)} disabled={currentIndex === 0} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowLeft size={14} />Previous step</button><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => void handleManualSave()} disabled={!editable || saveState === "saving"} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-navy hover:border-orange disabled:opacity-50"><Save size={14} />Save Progress</button><button type="button" onClick={() => void changeStep(PRODUCT_RESEARCH_TEMPLATE.sections[Math.min(PRODUCT_RESEARCH_TEMPLATE.sections.length - 1, currentIndex + 1)].id)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-xs font-extrabold text-white hover:bg-[#1d3042]">{currentIndex === PRODUCT_RESEARCH_TEMPLATE.sections.length - 2 ? "Review answers" : "Next step"}<ArrowRight size={14} /></button></div></div>}
        {currentStep === "submit-assignment" && <div className="mt-6 flex justify-between border-t border-slate-100 pt-5"><button type="button" onClick={() => void changeStep("final-analysis")} className="inline-flex items-center gap-2 text-xs font-bold text-slate-600"><ArrowLeft size={14} />Previous step</button>{editable && <button type="button" onClick={() => void handleManualSave()} disabled={saveState === "saving"} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-navy hover:border-orange"><Save size={14} />Save Progress</button>}</div>}
      </section></WorkspaceEditableContext.Provider>
    </div>
  </div>;
}
