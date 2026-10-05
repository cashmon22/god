import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Clock3, LoaderCircle, LogOut, Monitor, ShieldCheck, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getInterviewQuestions, getMyInterview, saveInterviewAnswer, startInterview, submitInterview, type InterviewQuestion, type InterviewRun } from "@/lib/interviews";

type Mode = "text" | "video";
type VideoState = "connecting" | "waiting";

const expiredMessage = "Your interview time has expired. You have been signed out for security reasons.";

export default function Interview() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [run, setRun] = useState<InterviewRun | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [videoState, setVideoState] = useState<VideoState>("connecting");
  const [remaining, setRemaining] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [schemaUpgradeRequired, setSchemaUpgradeRequired] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<number | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const answersRef = useRef(answers);
  const currentStepRef = useRef(currentStep);
  const expiringRef = useRef(false);
  const deadlineMonotonic = useRef<number | null>(null);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

  const applySession = useCallback((nextRun: InterviewRun) => {
    deadlineMonotonic.current = performance.now() + (nextRun.deadlineAt - nextRun.serverNow);
    setRun(nextRun);
    setMode("text");
    setCurrentStep(nextRun.index);
    setAnswers(Object.fromEntries(nextRun.answers.map(({ questionId, answer }) => [questionId, answer])));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getInterviewQuestions(), getMyInterview()]).then(([questionResult, interviewResult]) => {
      if (!active) return;
      setQuestions(questionResult.questions);
      if (interviewResult.schemaUpgradeRequired) {
        setSchemaUpgradeRequired(true);
        setError("The interview database update is required before timed interviews can start.");
      }
      if (interviewResult.submission) {
        setStatus(interviewResult.submission.status);
      } else if (interviewResult.session) {
        applySession(interviewResult.session);
      } else if (interviewResult.expired) {
        setIsExpired(true);
      }
    }).catch((loadError) => {
      if (!active) return;
      if (loadError instanceof Error && loadError.message.includes("expired")) setIsExpired(true);
      else setError(loadError instanceof Error ? loadError.message : "Unable to load your interview.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [applySession]);

  const finishExpiredSession = useCallback(async () => {
    if (expiringRef.current) return;
    expiringRef.current = true;
    setIsExpired(true);
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const question = questions[currentStepRef.current];
    if (run && question && deadlineMonotonic.current !== null && performance.now() < deadlineMonotonic.current) {
      try { await saveInterviewAnswer(question.id, answersRef.current[question.id] ?? "", currentStepRef.current); } catch { }
    }
    try { await getMyInterview(); } catch { }
    try { await signOut(); } finally {
      window.setTimeout(() => navigate("/login", { replace: true, state: { interviewExpired: true } }), 1800);
    }
  }, [navigate, questions, run, signOut]);

  useEffect(() => {
    if (isExpired) void finishExpiredSession();
  }, [finishExpiredSession, isExpired]);

  useEffect(() => {
    if (!run || isExpired) return;
    const tick = () => {
      const deadline = deadlineMonotonic.current ?? performance.now();
      const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) void finishExpiredSession();
    };
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [finishExpiredSession, isExpired, run]);

  useEffect(() => {
    if (mode !== "video" || videoState !== "connecting") return;
    const timeout = window.setTimeout(() => setVideoState("waiting"), 2200);
    return () => window.clearTimeout(timeout);
  }, [mode, videoState]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
  }, []);

  const enqueueSave = useCallback((question: InterviewQuestion, answer: string, targetIndex: number) => {
    saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
      const result = await saveInterviewAnswer(question.id, answer, targetIndex);
      deadlineMonotonic.current = performance.now() + (result.session.deadlineAt - result.session.serverNow);
      setRun(result.session);
      setCurrentStep(result.session.index);
    });
    return saveChain.current;
  }, []);

  const handleAnswerChange = (question: InterviewQuestion, value: string) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    if (!run) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void enqueueSave(question, value, currentStepRef.current).catch(() => undefined);
    }, 550);
  };

  const saveAndMove = async (targetIndex: number) => {
    const question = questions[currentStep];
    if (!question || !run || isSubmitting) return;
    const answer = answersRef.current[question.id] ?? "";
    if (targetIndex > currentStep && !answer.trim()) {
      setError("Please answer this question before continuing.");
      return;
    }
    setError("");
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await enqueueSave(question, answer, targetIndex);
    } catch (saveError) {
      if (saveError instanceof Error && saveError.message.includes("expired")) void finishExpiredSession();
      setError(saveError instanceof Error ? saveError.message : "Unable to save your answer.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !run || !questions.length) return;
    const missingAnswer = questions.find(({ id }) => !(answersRef.current[id] ?? "").trim());
    if (missingAnswer) {
      setError("Please answer every interview question before submitting.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await saveChain.current;
      const result = await submitInterview(questions.map(({ id, prompt }) => ({ questionId: id, prompt, answer: answersRef.current[id] ?? "" })));
      setStatus(result.submission.status);
      setRun(null);
    } catch (submitError) {
      if (submitError instanceof Error && submitError.message.includes("expired")) void finishExpiredSession();
      setError(submitError instanceof Error ? submitError.message : "Unable to submit your interview.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const chooseMode = async (selectedMode: Mode) => {
    setError("");
    if (selectedMode === "video") {
      setMode("video");
      setVideoState("connecting");
      return;
    }
    if (isStarting) return;
    setIsStarting(true);
    try {
      const result = await startInterview();
      applySession(result.session);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start your interview.");
      if (startError instanceof Error && startError.message.includes("expired")) void finishExpiredSession();
    } finally {
      setIsStarting(false);
    }
  };

  const cancelVideo = () => {
    setMode(null);
    setVideoState("connecting");
  };

  const handleSignOut = async () => {
    await signOut();
  };

  const currentQuestion = questions[currentStep];
  const progress = questions.length ? ((currentStep + 1) / questions.length) * 100 : 0;

  return <main className="min-h-screen bg-[#f8f9fa] px-4 py-6 text-ink sm:px-8 sm:py-12">
    <div className="mx-auto max-w-[860px]">
      <header className="mb-6 flex items-center justify-between"><Link to="/" className="text-sm font-extrabold text-navy">Contributor Portal</Link><button type="button" onClick={handleSignOut} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:text-navy"><LogOut size={14} /> Sign out</button></header>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(20,36,52,0.07)]">
        <div className="border-b border-slate-100 px-5 py-6 sm:px-9 sm:py-8"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-orange"><ShieldCheck size={21} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Contributor onboarding</p><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">Interview &amp; application</h1><p className="mt-3 max-w-[650px] text-sm leading-6 text-slate-500">Complete your interview to request contributor access. Your responses will be reviewed by an administrator.</p></div></div></div>
        <div className="px-5 py-6 sm:px-9 sm:py-8">
          {isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-slate-500"><LoaderCircle size={17} className="animate-spin text-orange" /> Loading your interview…</div>
            : isExpired ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center" role="alert"><CircleAlert className="mx-auto text-amber-700" size={25} /><h2 className="mt-3 text-lg font-extrabold text-navy">Interview time expired</h2><p className="mt-2 text-sm leading-6 text-slate-600">{expiredMessage}</p><p className="mt-4 text-xs font-semibold text-slate-500">Returning to sign in…</p></div>
              : status ? <div className="rounded-xl border border-slate-200 bg-[#fbfcfd] p-6" role="status"><div className="flex items-center gap-3"><CheckCircle2 className="text-orange" size={20} /><h2 className="text-base font-extrabold text-navy">Interview {status === "Under Review" ? "submitted" : status.toLowerCase()}</h2></div><p className="mt-3 text-sm leading-6 text-slate-500">{status === "Under Review" ? "Your answers have been received and are awaiting administrator review." : status === "Approved" ? "Your interview is approved. You can now access your contributor dashboard." : "Your interview was not approved. Please contact support if you need assistance."}</p>{status === "Approved" && <Link to="/dashboard" className="mt-5 inline-flex items-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy">Open dashboard <ArrowRight size={15} /></Link>}</div>
                : mode === "video" ? <div className="mx-auto max-w-[620px] py-5 text-center" aria-live="polite">
                  {videoState === "connecting" ? <><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-orange/10 text-orange"><LoaderCircle size={30} className="animate-spin" /></span><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Video interview</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Connecting to interview…</h2><p className="mt-3 text-sm leading-6 text-slate-500">Preparing your video interview. No live interviewer or video provider is connected, so this will continue as a waiting state rather than start a call.</p></>
                    : <><span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-navy"><Video size={28} /></span><p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Interview session</p><h2 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">Waiting for interview</h2><p className="mx-auto mt-3 max-w-[490px] text-sm leading-6 text-slate-500">There isn’t a live interviewer or video provider connected in this application yet. This is a waiting state only—no call has started. You can cancel and select the text interview instead.</p><div className="mx-auto mt-6 flex max-w-[410px] items-center justify-center gap-3 rounded-lg border border-slate-200 bg-[#fbfcfd] p-4 text-left"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500"><LoaderCircle size={17} className="animate-spin" /></span><p className="text-xs leading-5 text-slate-600">No live interview session is available. You can cancel and choose the text interview at any time.</p></div></>}
                  <button type="button" onClick={cancelVideo} className="mt-7 inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-navy hover:text-navy sm:w-auto">Cancel Interview</button>
                </div>
                : run ? <form onSubmit={currentStep === questions.length - 1 ? handleSubmit : (event) => { event.preventDefault(); void saveAndMove(currentStep + 1); }} className="space-y-6">
                  {questions.length === 0 || !currentQuestion ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Interview questions are not available yet.</div> : <>
                    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-[#fbfcfd] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-navy"><Clock3 size={19} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Time remaining</p><p className={`mt-0.5 text-2xl font-extrabold tabular-nums ${remaining <= 5 ? "text-red-600" : "text-navy"}`} aria-live="off">00:{String(remaining).padStart(2, "0")}</p></div></div><div className="w-full sm:max-w-[390px]"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-navy">Question {currentStep + 1} of {questions.length}</span><span className="font-semibold text-slate-400">{Math.round(progress)}% complete</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-orange transition-[width] duration-300" style={{ width: `${progress}%` }} /></div></div></div>
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><Monitor size={13} /> Text-based interview</div>
                    <label className="block" key={currentQuestion.id}><span className="block text-lg font-bold leading-7 text-navy sm:text-xl">{currentQuestion.prompt}</span><textarea required maxLength={5000} rows={7} value={answers[currentQuestion.id] ?? ""} onChange={(event) => handleAnswerChange(currentQuestion, event.target.value)} className="mt-4 min-h-48 w-full resize-y rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10" placeholder="Type your response here" /></label>
                  </>}
                  {error && <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</div>}
                  <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-400">Signed in as {session?.user.email}</p><div className="flex gap-3 sm:ml-auto"><button type="button" onClick={() => void saveAndMove(currentStep - 1)} disabled={currentStep === 0 || isSubmitting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:text-navy disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"><ArrowLeft size={15} /> Back</button>{currentStep < questions.length - 1 ? <button type="submit" disabled={isSubmitting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange px-6 py-3 text-sm font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">Next <ArrowRight size={15} /></button> : <button type="submit" disabled={isSubmitting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange px-6 py-3 text-sm font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none">{isSubmitting ? <><LoaderCircle size={15} className="animate-spin" /> Submitting…</> : "Submit Interview"}</button>}</div></div>
                </form>
                  : <>
                    <div className="mb-6"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Choose your interview format</p><h2 className="mt-2 text-xl font-extrabold tracking-tight text-navy sm:text-2xl">How would you like to interview?</h2><p className="mt-2 text-sm leading-6 text-slate-500">Select an interview experience to continue. Your questions and answers remain private.</p></div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <button type="button" onClick={() => void chooseMode("text")} disabled={questions.length === 0 || isStarting || schemaUpgradeRequired} className="group rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-orange/60 hover:shadow-[0_8px_28px_rgba(20,36,52,0.07)] disabled:cursor-not-allowed disabled:opacity-50 sm:p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange/10 text-orange"><Monitor size={21} /></span><span className="mt-5 block text-lg font-extrabold text-navy">Text-Based Interview</span><span className="mt-2 block text-sm leading-6 text-slate-500">Answer each interview question by typing, one at a time.</span><span className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">One question at a time</span><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">20 seconds per question</span></span><span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-navy group-hover:text-orange">{isStarting ? <><LoaderCircle size={15} className="animate-spin" /> Starting…</> : <>Start text interview <ArrowRight size={15} /></>}</span></button>
                      <button type="button" onClick={() => void chooseMode("video")} className="group rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-orange/60 hover:shadow-[0_8px_28px_rgba(20,36,52,0.07)] sm:p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy"><Video size={21} /></span><span className="mt-5 block text-lg font-extrabold text-navy">Video Interview</span><span className="mt-2 block text-sm leading-6 text-slate-500">Check for a live video session. If none is configured, you can wait here or choose the text interview instead.</span><span className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">Cancellable waiting state</span><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">Cancel anytime</span></span><span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-navy group-hover:text-orange">Check video availability <ArrowRight size={15} /></span></button>
                    </div>
                    {questions.length === 0 && <p className="mt-4 text-sm text-slate-500">Interview questions are not available yet. Please check back later.</p>}
                    <p className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-400"><ShieldCheck size={14} className="mt-0.5 shrink-0" />Your interview is securely timed. If time expires, you’ll be signed out automatically.</p>
                  </>}
          {error && !run && mode !== "video" && !isExpired && <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</div>}
        </div>
      </section>
    </div>
  </main>;
}
