import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera, CheckCircle2, CircleAlert, CircleDot, Clock3, LoaderCircle, LogOut, Mic, Monitor, ShieldCheck, Video } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getInterviewQuestions, getMyInterview, saveInterviewAnswer, startTextInterview, startInterviewQuestion, submitInterview, type InterviewQuestion, type InterviewRun } from "@/lib/interviews";

type Mode = "text" | "video";
type VideoState = "connecting" | "waiting" | "error";

export default function Interview() {
  const { session, signOut } = useAuth();
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [run, setRun] = useState<InterviewRun | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [videoState, setVideoState] = useState<VideoState>("connecting");
  const [remaining, setRemaining] = useState(60);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [finalQuestionComplete, setFinalQuestionComplete] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [questionStartRetry, setQuestionStartRetry] = useState(0);
  const [schemaUpgradeRequired, setSchemaUpgradeRequired] = useState(false);
  const [error, setError] = useState("");
  const saveTimer = useRef<number | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const answersRef = useRef(answers);
  const currentStepRef = useRef(currentStep);
  const runRef = useRef(run);
  const deadlineMonotonic = useRef<number | null>(null);
  const timedOutRef = useRef(false);
  const videoStream = useRef<MediaStream | null>(null);
  const videoRequestId = useRef(0);
  const videoPreview = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => { runRef.current = run; }, [run]);

  const applySession = useCallback((nextRun: InterviewRun) => {
    runRef.current = nextRun;
    deadlineMonotonic.current = nextRun.deadlineAt === null ? null : performance.now() + (nextRun.deadlineAt - nextRun.serverNow);
    timedOutRef.current = false;
    setRemaining(nextRun.deadlineAt === null ? 0 : Math.max(0, Math.ceil((nextRun.deadlineAt - nextRun.serverNow) / 1000)));
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
      if (interviewResult.submission) setStatus(interviewResult.submission.status);
    }).catch((loadError) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load your interview.");
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  const currentQuestion = questions[currentStep];

  useEffect(() => {
    if (!run || run.deadlineAt !== null || !currentQuestion) return;
    let active = true;
    startInterviewQuestion(run.id, run.index).then(({ session: startedSession }) => {
      if (active && runRef.current?.id === startedSession.id) applySession(startedSession);
    }).catch((timerError) => {
      if (active) setError(timerError instanceof Error ? timerError.message : "Unable to start the question timer.");
    });
    return () => { active = false; };
  }, [applySession, currentQuestion, questionStartRetry, run?.deadlineAt, run?.id, run?.index]);

  useEffect(() => {
    if (mode !== "video" || !videoStream.current || !videoPreview.current) return;
    videoPreview.current.srcObject = videoStream.current;
  }, [mode, videoState]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    videoRequestId.current += 1;
    videoStream.current?.getTracks().forEach((track) => track.stop());
    videoStream.current = null;
  }, []);

  const enqueueSave = useCallback((question: InterviewQuestion, answer: string, targetIndex: number) => {
    const sessionId = runRef.current?.id;
    if (!sessionId) return Promise.resolve();
    saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
      const result = await saveInterviewAnswer(sessionId, question.id, answer, targetIndex);
      deadlineMonotonic.current = result.session.deadlineAt === null ? null : performance.now() + (result.session.deadlineAt - result.session.serverNow);
      if (result.session.index !== currentStepRef.current) {
        timedOutRef.current = false;
        setRemaining(result.session.deadlineAt === null ? 0 : Math.max(0, Math.ceil((result.session.deadlineAt - result.session.serverNow) / 1000)));
        setFinalQuestionComplete(false);
      }
      runRef.current = result.session;
      setRun(result.session);
      setCurrentStep(result.session.index);
    });
    return saveChain.current;
  }, []);

  const handleAnswerChange = (question: InterviewQuestion, value: string) => {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    if (!run || run.deadlineAt === null || timedOutRef.current) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void enqueueSave(question, value, currentStepRef.current).catch(() => undefined);
    }, 550);
  };

  const advanceAfterTimeout = useCallback(async () => {
    const question = questions[currentStepRef.current];
    if (!run || !question || timedOutRef.current || isSubmitting) return;
    timedOutRef.current = true;
    setIsTransitioning(true);
    setError("");
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    try {
      if (currentStepRef.current === questions.length - 1) {
        await enqueueSave(question, answersRef.current[question.id] ?? "", currentStepRef.current);
        setFinalQuestionComplete(true);
      } else {
        await enqueueSave(question, answersRef.current[question.id] ?? "", currentStepRef.current + 1);
      }
      setIsTransitioning(false);
    } catch (saveError) {
      timedOutRef.current = false;
      setIsTransitioning(false);
      setError(saveError instanceof Error ? saveError.message : "Unable to save your answer.");
    }
  }, [enqueueSave, isSubmitting, questions, run]);

  useEffect(() => {
    if (!run || run.deadlineAt === null || finalQuestionComplete) return;
    const tick = () => {
      const deadline = deadlineMonotonic.current ?? performance.now();
      const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) void advanceAfterTimeout();
    };
    tick();
    const interval = window.setInterval(tick, 100);
    return () => window.clearInterval(interval);
  }, [advanceAfterTimeout, finalQuestionComplete, run]);

  const handleSubmit = async () => {
    if (isSubmitting || !run || !questions.length) return;
    setError("");
    setIsSubmitting(true);
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await saveChain.current;
      const result = await submitInterview(run.id, questions.map(({ id, prompt }) => ({ questionId: id, prompt, answer: answersRef.current[id] ?? "" })));
      setStatus(result.submission.status);
      setRun(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit your interview.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const chooseMode = async (selectedMode: Mode) => {
    setError("");
    if (selectedMode === "text") {
      setMode("text");
      return;
    }
    setVideoError("");
    setMode("video");
    setVideoState("connecting");
    const requestId = ++videoRequestId.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      if (requestId !== videoRequestId.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoStream.current = stream;
      setVideoState("waiting");
    } catch {
      if (requestId !== videoRequestId.current) return;
      setVideoState("error");
      setVideoError("Camera and microphone access is needed to prepare your interview. Update your browser permissions and try again.");
    }
  };

  const beginTextInterview = async () => {
    if (isStarting) return;
    setError("");
    setIsStarting(true);
    try {
      const result = await startTextInterview();
      setQuestions(result.questions);
      applySession(result.session);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start your interview.");
    } finally {
      setIsStarting(false);
    }
  };

  const cancelVideo = () => {
    videoRequestId.current += 1;
    videoStream.current?.getTracks().forEach((track) => track.stop());
    videoStream.current = null;
    setVideoError("");
    setMode(null);
    setVideoState("connecting");
  };

  const handleSignOut = async () => {
    await signOut();
  };


  const progress = questions.length ? ((currentStep + 1) / questions.length) * 100 : 0;

  return <main className="min-h-screen bg-[#f8f9fa] px-4 py-6 text-ink sm:px-8 sm:py-12">
    <div className="mx-auto max-w-[860px]">
      <header className="mb-6 flex items-center justify-between"><Link to="/" className="text-sm font-extrabold text-navy">Contributor Portal</Link><button type="button" onClick={handleSignOut} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:text-navy"><LogOut size={14} /> Sign out</button></header>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(20,36,52,0.07)]">
        <div className="border-b border-slate-100 px-5 py-6 sm:px-9 sm:py-8"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-orange"><ShieldCheck size={21} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Contributor onboarding</p><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">Interview &amp; application</h1><p className="mt-3 max-w-[650px] text-sm leading-6 text-slate-500">Complete your interview to request contributor access. Your responses will be reviewed by an administrator.</p></div></div></div>
        <div className="px-5 py-6 sm:px-9 sm:py-8">
          {isLoading ? <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-slate-500"><LoaderCircle size={17} className="animate-spin text-orange" /> Loading your interview…</div>
            : status ? <div className="rounded-xl border border-slate-200 bg-[#fbfcfd] p-6" role="status"><div className="flex items-center gap-3"><CheckCircle2 className="text-orange" size={20} /><h2 className="text-base font-extrabold text-navy">Interview {status === "Under Review" ? "submitted" : status.toLowerCase()}</h2></div><p className="mt-3 text-sm leading-6 text-slate-500">{status === "Under Review" ? "Your answers have been received and are awaiting administrator review." : status === "Approved" ? "Your interview is approved. You can now access your contributor dashboard." : "Your interview was not approved. Please contact support if you need assistance."}</p>{status === "Approved" && <Link to="/dashboard" className="mt-5 inline-flex items-center gap-2 rounded-md bg-orange px-5 py-3 text-sm font-extrabold text-navy">Open dashboard <ArrowRight size={15} /></Link>}</div>
                : mode === "text" && !run ? <div className="mx-auto max-w-[560px] py-8 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-orange/10 text-orange"><Monitor size={22} /></span><h2 className="mt-4 text-xl font-extrabold text-navy">Text-Based Interview</h2><p className="mt-2 text-sm leading-6 text-slate-500">Your 60-second question timer begins when Question 1 appears. Starting creates a new interview attempt.</p><div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" onClick={() => void beginTextInterview()} disabled={isStarting || schemaUpgradeRequired} className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange px-6 py-3 text-sm font-extrabold text-navy disabled:opacity-50">{isStarting ? <><LoaderCircle size={15} className="animate-spin" /> Starting…</> : <>Start Interview <ArrowRight size={15} /></>}</button><button type="button" onClick={() => setMode(null)} disabled={isStarting} className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700">Back</button></div></div>
                : mode === "video" ? <div className="mx-auto max-w-[760px] py-2" aria-live="polite">
                  {videoState === "connecting" ? <div className="py-12 text-center"><LoaderCircle size={30} className="mx-auto animate-spin text-orange" /><p className="mt-5 text-sm font-semibold text-slate-600">Preparing your camera and microphone…</p><button type="button" onClick={cancelVideo} className="mt-6 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700">Cancel Interview</button></div> : videoState === "error" ? <div className="mx-auto max-w-[460px] py-10 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700"><CircleAlert size={23} /></span><h2 className="mt-4 text-xl font-extrabold text-navy">Check your device permissions</h2><p className="mt-2 text-sm leading-6 text-slate-500">{videoError}</p><div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" onClick={() => void chooseMode("video")} className="rounded-lg bg-orange px-5 py-3 text-sm font-extrabold text-navy">Try again</button><button type="button" onClick={cancelVideo} className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700">Cancel Interview</button></div></div> : <>
                    <div className="grid gap-7 md:grid-cols-[1.15fr_0.85fr] md:items-center">
                      <div className="overflow-hidden rounded-2xl bg-[#101923] shadow-[0_16px_40px_rgba(20,36,52,0.16)]">
                        <video ref={videoPreview} autoPlay playsInline muted aria-label="Live camera preview" className="aspect-video w-full object-cover" />
                        <div className="flex items-center justify-between px-4 py-3 text-xs font-semibold text-white"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Camera preview</span><span className="text-white/60">Only visible to you</span></div>
                      </div>
                      <div className="text-center md:text-left">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Video interview waiting room</p>
                        <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-navy">You're all set</h2>
                        <p className="mt-3 text-sm leading-6 text-slate-500">Your interview session is being prepared. Please remain on this page while we connect you with an interviewer.</p>
                        <div className="mt-6 rounded-xl border border-slate-200 bg-[#fbfcfd] p-4 text-left">
                          <div className="flex items-center gap-3"><span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-orange/10 text-orange"><span className="absolute inset-0 animate-ping rounded-full bg-orange/15" /><LoaderCircle size={17} className="relative animate-spin" /></span><div><p className="text-sm font-bold text-navy">Waiting for interviewer...</p><p className="mt-1 text-xs text-slate-500">An interviewer will join you shortly.</p></div></div>
                          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4"><p className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Camera size={15} className="text-emerald-600" /> Camera connected</p><p className="flex items-center gap-2 text-xs font-semibold text-slate-600"><Mic size={15} className="text-emerald-600" /> Microphone connected</p><p className="flex items-center gap-2 text-xs font-semibold text-slate-600"><CircleDot size={15} className="animate-pulse text-orange" /> Waiting for interviewer</p></div>
                        </div>
                      </div>
                    </div>
                    {videoError && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="alert">{videoError}</div>}
                    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-400">Your camera and microphone are not being recorded.</p><button type="button" onClick={cancelVideo} className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-navy hover:text-navy sm:w-auto">Cancel Interview</button></div>
                  </>}
                </div>
                : run ? <div className="space-y-6">
                  {questions.length === 0 || !currentQuestion ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" role="alert">Interview questions are not available yet.</div> : <>
                    <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-[#fbfcfd] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-navy"><Clock3 size={19} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Time remaining</p><p className="mt-0.5 text-2xl font-extrabold tabular-nums text-navy" aria-live="off">{run.deadlineAt === null ? "Starting…" : `${remaining}s`}</p></div></div><div className="w-full sm:max-w-[390px]"><div className="mb-2 flex items-center justify-between text-xs"><span className="font-bold text-navy">Question {currentStep + 1} of {questions.length}</span><span className="font-semibold text-slate-400">{Math.round(progress)}% complete</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-orange transition-[width] duration-300" style={{ width: `${progress}%` }} /></div></div></div>
                    {isTransitioning && <p className="rounded-lg border border-orange/20 bg-orange/5 px-4 py-3 text-sm font-semibold text-navy" role="status">Time is up. Moving to the next question...</p>}
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><Monitor size={13} /> Text-based interview</div>
                    <label className="block" key={currentQuestion.id}><span className="block text-lg font-bold leading-7 text-navy sm:text-xl">{currentQuestion.prompt}</span><textarea maxLength={5000} rows={7} disabled={isTransitioning || run.deadlineAt === null || remaining === 0} value={answers[currentQuestion.id] ?? ""} onChange={(event) => handleAnswerChange(currentQuestion, event.target.value)} className="mt-4 min-h-48 w-full resize-y rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10 disabled:bg-slate-50" placeholder="Type your response here" /></label>
                  </>}
                  {error && <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert"><span className="flex items-start gap-2"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</span>{run.deadlineAt === null && <button type="button" onClick={() => { setError(""); setQuestionStartRetry((retry) => retry + 1); }} className="self-start font-bold underline">Retry question timer</button>}</div>}
                  <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-400">Signed in as {session?.user.email}</p>{currentStep === questions.length - 1 && finalQuestionComplete && <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange px-6 py-3 text-sm font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? <><LoaderCircle size={15} className="animate-spin" /> Submitting…</> : "Submit Interview"}</button>}</div>
                </div>
                  : <>
                    <div className="mb-6"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange">Choose your interview format</p><h2 className="mt-2 text-xl font-extrabold tracking-tight text-navy sm:text-2xl">How would you like to interview?</h2><p className="mt-2 text-sm leading-6 text-slate-500">Select an interview experience to continue. Your questions and answers remain private.</p></div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <button type="button" onClick={() => void chooseMode("text")} disabled={questions.length === 0 || isStarting || schemaUpgradeRequired} className="group rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-orange/60 hover:shadow-[0_8px_28px_rgba(20,36,52,0.07)] disabled:cursor-not-allowed disabled:opacity-50 sm:p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange/10 text-orange"><Monitor size={21} /></span><span className="mt-5 block text-lg font-extrabold text-navy">Text-Based Interview</span><span className="mt-2 block text-sm leading-6 text-slate-500">Answer each interview question by typing, one at a time.</span><span className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">One question at a time</span><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">60 seconds per question</span></span><span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-navy group-hover:text-orange">Select text format <ArrowRight size={15} /></span></button>
                      <button type="button" onClick={() => void chooseMode("video")} className="group rounded-xl border border-slate-200 bg-white p-5 text-left transition hover:border-orange/60 hover:shadow-[0_8px_28px_rgba(20,36,52,0.07)] sm:p-6"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy/5 text-navy"><Video size={21} /></span><span className="mt-5 block text-lg font-extrabold text-navy">Video Interview</span><span className="mt-2 block text-sm leading-6 text-slate-500">Prepare your camera and microphone, then wait here for your interviewer.</span><span className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">Private camera preview</span><span className="rounded-full bg-[#f3f5f7] px-2.5 py-1 text-[10px] font-bold text-slate-600">Cancel anytime</span></span><span className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold text-navy group-hover:text-orange">Enter waiting room <ArrowRight size={15} /></span></button>
                    </div>
                    {questions.length === 0 && <p className="mt-4 text-sm text-slate-500">Interview questions are not available yet. Please check back later.</p>}
                    <p className="mt-6 flex items-start gap-2 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-400"><ShieldCheck size={14} className="mt-0.5 shrink-0" />Each question has a secure 60-second timer. Your answer is saved as you work.</p>
                  </>}
          {error && !run && mode !== "video" && <div className="mt-5 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error}</div>}
        </div>
      </section>
    </div>
  </main>;
}
