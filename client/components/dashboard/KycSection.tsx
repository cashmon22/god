import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, FileCheck2, FileImage, Info, LoaderCircle, ShieldCheck, Upload, X } from "lucide-react";
import { createKycDraft, getKycInstructions, getMyKyc, saveKycDraft, submitKyc, uploadKycFile, type KycIdentityInformation, type KycInstructions, type KycSubmission } from "@/lib/kyc";

const blankIdentity: KycIdentityInformation = { fullName: "", dateOfBirth: "", documentNumber: "", expiryDate: "" };
const steps = ["Introduction", "Government ID", "ID information", "Selfie", "Review", "Submit"];
const inputClass = "mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-navy outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/20";
const acceptedMime = ["image/jpeg", "image/png", "image/webp"];

type PhotoCheck = { file: File; preview: string; flags: string[] };

async function inspectPhoto(file: File, minSide: number, documentPhoto = false): Promise<string[]> {
  const flags: string[] = [];
  if (!acceptedMime.includes(file.type)) return ["Unsupported file type. Upload a JPEG, PNG, or WebP photo."];
  if (file.size > 10 * 1024 * 1024) return ["Image is too large. Choose a photo smaller than 10 MB."];
  if (file.size < 1024) return ["The image file is too small to review. Please take another photo."];
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => { URL.revokeObjectURL(source); resolve(element); };
    element.onerror = () => { URL.revokeObjectURL(source); reject(new Error("Unable to read image.")); };
    element.src = source;
  });
  if (Math.min(image.naturalWidth, image.naturalHeight) < minSide) flags.push("Image resolution is too small. Move closer and take another photo.");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 600 / image.naturalWidth, 600 / image.naturalHeight);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return flags;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let brightness = 0;
  let glare = 0;
  let edge = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const index = (y * width + x) * 4;
      const gray = (data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
      const right = (data[index + 4] * 0.299 + data[index + 5] * 0.587 + data[index + 6] * 0.114);
      const below = ((data[index + width * 4] * 0.299) + (data[index + width * 4 + 1] * 0.587) + (data[index + width * 4 + 2] * 0.114));
      brightness += gray;
      if (data[index] > 247 && data[index + 1] > 247 && data[index + 2] > 247) glare++;
      edge += Math.abs(gray - right) + Math.abs(gray - below);
      count++;
    }
  }
  const average = brightness / count;
  if (documentPhoto) {
    if (average < 35) flags.push("Photo may be too dark to review. Retake it in brighter, even lighting.");
    if (average > 245) flags.push("Photo may be overexposed. Check for glare and retake if details are washed out.");
    if (average > 235 && glare / count > 0.45) flags.push("Bright areas may obscure details. Check for glare and retake if needed.");
    if (edge / count < 5) flags.push("Photo may be too blurry or low-contrast to read. Check the preview and retake if needed.");
  } else {
    if (average < 42) flags.push("Photo is too dark. Retake it in brighter, even lighting.");
    if (average > 226) flags.push("Photo is overexposed. Reduce the light or glare and retake it.");
    if (glare / count > 0.14) flags.push("There is excessive glare. Tilt the document away from direct light and retake it.");
    if (edge / count < 11) flags.push("The image appears too blurry or low-contrast to read. Hold still and retake it.");
  }
  return flags;
}

export default function KycSection({ userId, deviceApproved }: { userId: string; deviceApproved: boolean }) {
  const [instructions, setInstructions] = useState<KycInstructions | null>(null);
  const [submission, setSubmission] = useState<KycSubmission | null>(null);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [idType, setIdType] = useState("");
  const [identity, setIdentity] = useState<KycIdentityInformation>(blankIdentity);
  const [idPhoto, setIdPhoto] = useState<PhotoCheck | null>(null);
  const [selfiePhoto, setSelfiePhoto] = useState<PhotoCheck | null>(null);
  const [idPhotoPath, setIdPhotoPath] = useState<string | null>(null);
  const [selfiePhotoPath, setSelfiePhotoPath] = useState<string | null>(null);
  const [idPhotoConfirmed, setIdPhotoConfirmed] = useState(false);
  const [selfieConfirmed, setSelfieConfirmed] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getKycInstructions(), getMyKyc()]).then(([nextInstructions, result]) => {
      if (!active) return;
      setInstructions(nextInstructions);
      if (result.submission) {
        const current = result.submission;
        setSubmission(current);
        if (current.status === "draft") {
          setConsent(Boolean(current.consent_at));
          setIdType(current.id_type ?? "");
          setIdentity({ ...blankIdentity, ...current.identity_information });
          setIdPhotoPath(current.id_image_path);
          setSelfiePhotoPath(current.selfie_image_path);
          setIdPhotoConfirmed(Boolean(current.capture_confirmations?.idPhotoReadable));
          setSelfieConfirmed(Boolean(current.capture_confirmations?.selfieCentered));
          const savedStep = Number(localStorage.getItem(`kyc-step-${userId}-${current.id}`));
          if (Number.isInteger(savedStep) && savedStep >= 0 && savedStep < 5) setStep(savedStep);
        }
      }
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "Unable to load KYC.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (idPhoto?.preview.startsWith("blob:")) URL.revokeObjectURL(idPhoto.preview);
    if (selfiePhoto?.preview.startsWith("blob:")) URL.revokeObjectURL(selfiePhoto.preview);
  }, [idPhoto, selfiePhoto]);

  useEffect(() => {
    if (!cameraReady || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setCameraError("Camera preview could not start. Please allow camera access and try again."));
  }, [cameraReady]);

  useEffect(() => {
    if (step !== 3) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCameraReady(false);
    }
  }, [step]);

  const activeDraft = submission?.status === "draft" ? submission : null;
  const startDraft = async (acceptedConsent = false) => {
    setError("");
    setSaving(true);
    try {
      const result = await createKycDraft();
      if (acceptedConsent) await saveKycDraft(result.submission.id, { consent: true });
      const next = await getMyKyc();
      setSubmission(next.submission ?? { ...result.submission, user_id: userId, consent_at: null, id_type: null, id_image_path: null, selfie_image_path: null, identity_information: blankIdentity, quality_flags: [], rejection_reason: null, submitted_at: null, reviewed_at: null, id_image_url: null, selfie_image_url: null });
      setConsent(acceptedConsent);
      setIdType("");
      setIdentity(blankIdentity);
      setIdPhotoPath(null);
      setSelfiePhotoPath(null);
      setIdPhotoConfirmed(false);
      setSelfieConfirmed(false);
      setStep(acceptedConsent ? 1 : 0);
      if (acceptedConsent) localStorage.setItem(`kyc-step-${userId}-${result.submission.id}`, "1");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to start KYC.");
    } finally { setSaving(false); }
  };

  const saveProgress = async (targetStep: number) => {
    if (!activeDraft) return false;
    setSaving(true);
    setError("");
    try {
      await saveKycDraft(activeDraft.id, {
        consent,
        idType,
        idImagePath: idPhotoPath,
        selfieImagePath: selfiePhotoPath,
        identityInformation: identity,
        confirmations: { idPhotoReadable: idPhotoConfirmed, selfieCentered: selfieConfirmed },
        qualityFlags: [...(idPhoto?.flags ?? []), ...(selfiePhoto?.flags ?? [])],
      });
      localStorage.setItem(`kyc-step-${userId}-${activeDraft.id}`, String(targetStep));
      setStep(targetStep);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save progress.");
      return false;
    } finally { setSaving(false); }
  };

  const handlePhoto = async (file: File, kind: "id" | "selfie") => {
    if (!activeDraft) return;
    const confirmations = { idPhotoReadable: kind === "id" ? false : idPhotoConfirmed, selfieCentered: kind === "selfie" ? false : selfieConfirmed };
    const preview = URL.createObjectURL(file);
    if (kind === "id") {
      setIdPhotoConfirmed(false);
      setIdPhotoPath(null);
      setIdPhoto({ file, preview, flags: [] });
    } else {
      setSelfieConfirmed(false);
      setSelfiePhotoPath(null);
      setSelfiePhoto({ file, preview, flags: [] });
    }
    setSaving(true);
    setError("");
    try {
      await saveKycDraft(activeDraft.id, { [kind === "id" ? "idImagePath" : "selfieImagePath"]: null, confirmations });
      let flags: string[];
      try {
        flags = await inspectPhoto(file, kind === "id" ? 320 : 400, kind === "id");
      } catch {
        flags = ["Image could not be read. Choose another photo."];
        if (kind === "id") setIdPhoto({ file, preview, flags });
        else setSelfiePhoto({ file, preview, flags });
        setError(flags[0]);
        return;
      }
      if (kind === "id") setIdPhoto({ file, preview, flags });
      else setSelfiePhoto({ file, preview, flags });
      if (!acceptedMime.includes(file.type) || file.size > 10 * 1024 * 1024 || file.size < 1024) {
        setError(flags[0]);
        return;
      }
      const path = await uploadKycFile(activeDraft.id, kind, file, file.type);
      if (kind === "id") setIdPhotoPath(path);
      else setSelfiePhotoPath(path);
      await saveKycDraft(activeDraft.id, { [kind === "id" ? "idImagePath" : "selfieImagePath"]: path });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to upload this photo.");
      if (kind === "id") setIdPhotoPath(null);
      else setSelfiePhotoPath(null);
    } finally { setSaving(false); }
  };

  const clearPhoto = async (kind: "id" | "selfie") => {
    if (!activeDraft) return;
    setError("");
    try {
      await saveKycDraft(activeDraft.id, {
        [kind === "id" ? "idImagePath" : "selfieImagePath"]: null,
        confirmations: { idPhotoReadable: kind === "id" ? false : idPhotoConfirmed, selfieCentered: kind === "selfie" ? false : selfieConfirmed },
      });
      if (kind === "id") {
        setIdPhoto(null);
        setIdPhotoPath(null);
        setIdPhotoConfirmed(false);
      } else {
        setSelfiePhoto(null);
        setSelfiePhotoPath(null);
        setSelfieConfirmed(false);
      }
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to update the image.");
    }
  };

  const startCamera = async () => {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser. Use a supported browser with camera permission.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraReady(true);
    } catch {
      setCameraError("Camera permission was unavailable. Allow camera access in your browser settings and try again.");
    }
  };

  const captureSelfie = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) { setError("Could not capture the photo. Please try again."); return; }
    const file = new File([blob], "selfie.jpg", { type: "image/jpeg" });
    await handlePhoto(file, "selfie");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const submit = async () => {
    if (!activeDraft || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (!(await saveProgress(4))) return;
      await submitKyc(activeDraft.id);
      const result = await getMyKyc();
      setSubmission(result.submission);
      localStorage.removeItem(`kyc-step-${userId}-${activeDraft.id}`);
      setStep(5);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit KYC.");
    } finally { setSubmitting(false); }
  };

  if (!deviceApproved) return <section className="rounded-2xl border border-amber-200 bg-white p-6 sm:p-9"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><ShieldCheck size={23} /></div><h1 className="mt-5 text-2xl font-extrabold text-navy">Identity verification</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">KYC becomes available after your device has been approved. Your dashboard remains available in the meantime.</p></section>;
  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading secure KYC status…</div>;
  if (error && !instructions) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{error}</div>;

  if (submission?.status === "pending" || submission?.status === "approved") {
    const approved = submission.status === "approved";
    return <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-10"><span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${approved ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{approved ? <CheckCircle2 size={28} /> : <ShieldCheck size={28} />}</span><p className="mt-6 text-[10px] font-extrabold uppercase tracking-[0.16em] text-orange">Identity verification</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">{approved ? "KYC approved" : "KYC submitted"}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{approved ? "Your identity documents have been approved. You can now access withdrawal details." : "Your identity verification has been submitted for review. You will be notified when an administrator makes a decision."}</p><span className={`mt-6 inline-flex rounded-full px-3 py-1.5 text-xs font-extrabold ${approved ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{approved ? "Approved" : "Under Review"}</span></section>;
  }

  if (submission?.status === "rejected" && !activeDraft) {
    return <section className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-white p-6 shadow-card sm:p-10"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700"><AlertCircle size={28} /></span><p className="mt-6 text-[10px] font-extrabold uppercase tracking-[0.16em] text-orange">Identity verification</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Changes requested</h1><p className="mt-3 text-sm leading-6 text-slate-600">An administrator reviewed your submission and provided the following reason:</p><div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-4 text-sm leading-6 text-red-900">{submission.rejection_reason}</div><button type="button" onClick={() => void startDraft()} disabled={saving} className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-orange px-5 text-sm font-extrabold text-navy disabled:opacity-60">{saving ? <LoaderCircle size={17} className="animate-spin" /> : null}Resubmit KYC</button></section>;
  }

  if (!activeDraft) return <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-10"><p className="text-xs font-bold text-navy">Step 1 of 6 · Introduction</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-1/6 rounded-full bg-orange" /></div><span className="mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange/10 text-orange"><ShieldCheck size={28} /></span><p className="mt-6 text-[10px] font-extrabold uppercase tracking-[0.16em] text-orange">Contributor identity check</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Verify your identity</h1><p className="mt-4 text-sm leading-6 text-slate-600">To protect contributors and prevent fraudulent accounts, we need to verify your identity before withdrawals can be processed.</p><ul className="mt-6 grid gap-3 sm:grid-cols-2">{["Valid government-issued ID", "Clear photo of the ID", "Selfie/face photo", "Information must be readable and belong to you"].map((requirement) => <li key={requirement} className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-700"><Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />{requirement}</li>)}</ul><div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">{instructions?.instructions}</div><label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange" /><span className="text-xs leading-5 text-slate-700">I confirm that the information and documents I provide are mine, accurate, and may be reviewed by authorized administrators for identity verification.</span></label>{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}<button type="button" disabled={!consent || saving} onClick={() => void startDraft(true)} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-orange px-5 text-sm font-extrabold text-navy transition hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">{saving ? <LoaderCircle size={17} className="animate-spin" /> : null}Continue <ArrowRight size={16} /></button></section>;

  const setField = (field: keyof KycIdentityInformation, value: string) => setIdentity((current) => ({ ...current, [field]: value }));
  const selectedType = instructions?.acceptedIdTypes.find((type) => type.id === idType);
  const imageFlag = idPhoto?.flags[0];
  const selfieFlags = selfiePhoto?.flags ?? [];
  const selfieFlag = selfieFlags.length > 0;
  const stepValid = step === 0 ? consent
    : step === 1 ? Boolean(idType && idPhotoPath && idPhotoConfirmed)
    : step === 2 ? Boolean(identity.fullName.trim() && identity.dateOfBirth && identity.documentNumber.trim())
    : step === 3 ? Boolean(selfiePhotoPath && selfieConfirmed)
    : true;

  const next = async (continueWithQualityWarning = false) => {
    if (!stepValid || (step === 3 && selfieFlag && !continueWithQualityWarning)) return;
    if (step === 0) setConsent(true);
    await saveProgress(Math.min(step + 1, 4));
  };
  const back = () => {
    setError("");
    const previous = Math.max(0, step - 1);
    localStorage.setItem(`kyc-step-${userId}-${activeDraft.id}`, String(previous));
    setStep(previous);
  };

  return <div className="mx-auto max-w-4xl">
    <header className="mb-6"><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-orange">Contributor identity check</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight text-navy">Verify your identity</h1><p className="mt-2 text-sm leading-6 text-slate-500">Your progress is saved as you move through each step.</p></header>
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex items-center justify-between"><span className="text-xs font-bold text-navy">Step {step + 1} of 6</span><span className="text-xs font-semibold text-slate-500">{steps[step]}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange transition-all" style={{ width: `${((step + 1) / 6) * 100}%` }} /></div><div className="mt-3 hidden grid-cols-5 gap-2 sm:grid">{steps.map((name, index) => <span key={name} className={`text-[10px] font-bold ${index <= step ? "text-navy" : "text-slate-400"}`}>{index + 1}. {name}</span>)}</div></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-8">
      {step === 0 && <><h2 className="text-xl font-extrabold text-navy">Before you begin</h2><p className="mt-2 text-sm leading-6 text-slate-600">{instructions?.instructions}</p><ul className="mt-5 space-y-3">{["Valid government-issued ID", "Clear photo with all edges visible", "A clear selfie provided by camera capture or upload", "Information that is readable and belongs to you"].map((item) => <li key={item} className="flex items-center gap-3 text-sm text-slate-700"><CheckCircle2 size={17} className="text-emerald-600" />{item}</li>)}</ul><label className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange" /><span className="text-xs leading-5 text-slate-700">I confirm that the information and documents I provide are mine and accurate, and consent to their review by authorized administrators.</span></label></>}
      {step === 1 && <><h2 className="text-xl font-extrabold text-navy">Government ID</h2><p className="mt-2 text-sm leading-6 text-slate-600">Select an accepted document and upload a clear image of the full ID.</p><label className="mt-5 block text-xs font-bold text-slate-600">Accepted ID type<select value={idType} onChange={(event) => { setIdType(event.target.value); setIdPhotoConfirmed(false); }} className={inputClass}><option value="">Choose an ID type</option>{instructions?.acceptedIdTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select></label>{selectedType && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-900">{selectedType.instructions}</p>}<label className="mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:border-orange"><Upload size={22} className="text-orange" /><span className="mt-3 text-sm font-extrabold text-navy">Choose ID photo</span><span className="mt-1 text-xs text-slate-500">JPEG, PNG, or WebP · maximum 10 MB</span><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePhoto(file, "id"); event.currentTarget.value = ""; }} /></label>{(idPhoto || submission?.id_image_url) && <div className="mt-4 flex items-start gap-4 rounded-lg border border-slate-200 p-3"><img src={idPhoto?.preview ?? submission?.id_image_url ?? ""} alt="ID photo preview" className="h-24 w-36 rounded-md object-cover" /><div className="min-w-0 flex-1"><p className="text-sm font-bold text-navy">{imageFlag ? "Photo needs attention" : saving ? "Uploading securely…" : idPhotoPath ? "ID image ready" : "Selected photo"}</p>{imageFlag && <p className="mt-1 text-xs leading-5 text-amber-800">Retake recommended: {imageFlag}</p>}{!imageFlag && <p className="mt-1 text-xs leading-5 text-slate-500">Check the preview before continuing.</p>}</div><button type="button" onClick={() => void clearPhoto("id")} aria-label="Remove ID photo" className="rounded p-1 text-slate-400 hover:text-red-600"><X size={17} /></button></div>}<label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 p-4"><input type="checkbox" checked={idPhotoConfirmed} disabled={!idPhotoPath} onChange={(event) => setIdPhotoConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange" /><span className="text-xs leading-5 text-slate-700">I can see the document edges and read the details. I understand any photo-quality note is a recommendation for review, not an automatic rejection.</span></label><p className="mt-3 text-[11px] leading-5 text-slate-500">Automatic photo checks are advisory and do not verify a document’s authenticity. Please retake or review the photo if details are hard to see; an administrator reviews submitted images.</p></>}
      {step === 2 && <><h2 className="text-xl font-extrabold text-navy">Confirm your ID information</h2><p className="mt-2 text-sm leading-6 text-slate-600">No OCR service is connected, so enter the information exactly as it appears on your document.</p><div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><Info size={15} className="mr-2 inline" />Your details must match the ID you submitted. Do not guess missing information.</div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Full legal name<input autoComplete="name" value={identity.fullName} onChange={(event) => setField("fullName", event.target.value)} className={inputClass} /></label><label className="text-xs font-bold text-slate-600">Date of birth<input type="date" autoComplete="bday" value={identity.dateOfBirth} onChange={(event) => setField("dateOfBirth", event.target.value)} className={inputClass} /></label><label className="text-xs font-bold text-slate-600">ID document number<input autoComplete="off" value={identity.documentNumber} onChange={(event) => setField("documentNumber", event.target.value)} className={inputClass} /></label><label className="text-xs font-bold text-slate-600">Expiry date (if shown)<input type="date" value={identity.expiryDate} onChange={(event) => setField("expiryDate", event.target.value)} className={inputClass} /></label></div></>}
      {step === 3 && <><h2 className="text-xl font-extrabold text-navy">Provide a selfie</h2><p className="mt-2 text-sm leading-6 text-slate-600">Use your device camera, face the light, and center your face in the guide. No liveness verification service is integrated; a detected or captured face is not treated as identity verification.</p><div className="mt-5 overflow-hidden rounded-xl bg-navy"><div className="relative aspect-[4/3] w-full">{cameraReady ? <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" /> : selfiePhoto || submission?.selfie_image_url ? <img src={selfiePhoto?.preview ?? submission?.selfie_image_url ?? ""} alt="Captured selfie preview" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center text-white/70"><Camera size={34} className="text-orange" /><p className="mt-3 text-sm font-semibold">Camera preview appears here</p></div>}<div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="h-[70%] w-[52%] rounded-[48%] border-2 border-dashed border-white/80 shadow-[0_0_0_999px_rgba(9,22,35,0.12)]" /></div></div></div>{cameraError && <p role="alert" className="mt-3 text-sm text-red-700">{cameraError}</p>}{selfieFlag && selfiePhotoPath && <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">Photo quality suggestion</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{selfieFlags.map((flag, index) => <li key={`${flag}-${index}`}>{flag}</li>)}</ul><p className="mt-2 text-xs leading-5">These suggestions do not determine whether this is your face. An administrator will review your submission.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { void clearPhoto("selfie"); void startCamera(); }} disabled={saving} className="h-10 rounded-lg border border-amber-300 px-4 text-xs font-bold text-amber-950 disabled:opacity-50">Retake Photo</button><button type="button" onClick={() => void next(true)} disabled={!stepValid || saving || submitting} className="h-10 rounded-lg bg-navy px-4 text-xs font-extrabold text-white disabled:opacity-50">Continue Anyway</button></div></div>}<div className="mt-4 flex flex-wrap gap-3">{cameraReady ? <button type="button" onClick={() => void captureSelfie()} disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-orange px-4 text-sm font-extrabold text-navy"><Camera size={17} />Capture selfie</button> : <button type="button" onClick={() => void startCamera()} className="inline-flex h-11 items-center gap-2 rounded-lg bg-navy px-4 text-sm font-extrabold text-white"><Camera size={17} />{selfiePhoto ? "Retake selfie" : "Start camera"}</button>}{selfiePhoto && <button type="button" onClick={() => void clearPhoto("selfie")} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600">Retake <Camera size={16} /></button>}</div><label className="mt-4 flex h-11 w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-600"><Upload size={16} />Upload selfie<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handlePhoto(file, "selfie"); event.currentTarget.value = ""; }} /></label><label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 p-4"><input type="checkbox" checked={selfieConfirmed} disabled={!selfiePhotoPath} onChange={(event) => setSelfieConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-orange" /><span className="text-xs leading-5 text-slate-700">I confirm this is my selfie and my face is visible in the photo for administrator review.</span></label><p className="mt-3 text-[11px] leading-5 text-slate-500">This browser does not provide reliable automated face, obstruction, or liveness checks. A reviewer will inspect the selfie.</p></>}
      {step === 4 && <><h2 className="text-xl font-extrabold text-navy">Review your submission</h2><p className="mt-2 text-sm leading-6 text-slate-600">Check the details before submitting. You can go back to make changes.</p><div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">{[{ label: "Government ID", value: `${selectedType?.label ?? "ID"} · Photo uploaded`, complete: Boolean(idPhotoPath) }, { label: "ID information", value: identity.fullName, complete: Boolean(identity.fullName && identity.dateOfBirth && identity.documentNumber) }, { label: "Selfie", value: "Selfie photo provided", complete: Boolean(selfiePhotoPath) }].map((item) => <div key={item.label} className="flex items-start gap-3 p-4"><CheckCircle2 size={18} className={item.complete ? "mt-0.5 text-emerald-600" : "mt-0.5 text-red-500"} /><div className="min-w-0"><p className="text-sm font-extrabold text-navy">{item.label}: {item.complete ? "Complete" : "Missing"}</p><p className="mt-1 break-words text-xs text-slate-500">{item.value}</p></div></div>)}</div><div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs leading-5 text-slate-600"><p className="font-bold text-navy">Information provided</p><p className="mt-2">Name: {identity.fullName}</p><p>Date of birth: {identity.dateOfBirth}</p><p>Document number: ••••{identity.documentNumber.slice(-4)}</p><p>Expiry date: {identity.expiryDate || "Not provided"}</p></div><p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500"><FileCheck2 size={15} className="mt-0.5 shrink-0" />Submission is reviewed by an administrator. Automatic image checks do not establish document authenticity or identity.</p></>}
      {error && <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-between">{step > 0 ? <button type="button" onClick={back} disabled={saving || submitting} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-5 text-sm font-bold text-slate-600 disabled:opacity-50"><ArrowLeft size={16} />Back</button> : <span />}{step < 4 ? <button type="button" onClick={() => void next()} disabled={!stepValid || saving || submitting || (step === 3 && selfieFlag)} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-orange px-5 text-sm font-extrabold text-navy disabled:cursor-not-allowed disabled:opacity-50">{saving ? <LoaderCircle size={17} className="animate-spin" /> : null}Next <ArrowRight size={16} /></button> : <button type="button" onClick={() => void submit()} disabled={!stepValid || saving || submitting} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-orange px-5 text-sm font-extrabold text-navy disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <LoaderCircle size={17} className="animate-spin" /> : <FileImage size={17} />}Submit KYC</button>}</div>
    </section>
  </div>;
}
