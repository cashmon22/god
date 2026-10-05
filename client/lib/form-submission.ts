import { getCurrentSession } from "./supabase";

const FORMSPREE_ENDPOINT = "https://formspree.io/f/mvkodbjw";
const submittingFormTypes = new Set<string>();

export const FORM_SUBMISSION_ERROR = "Unable to submit your form. Please try again.";

class SubmissionError extends Error {}

export async function submitForm(formType: string, formData: Record<string, unknown>) {
  if (submittingFormTypes.has(formType)) throw new Error(FORM_SUBMISSION_ERROR);

  submittingFormTypes.add(formType);
  try {
    const submittedAt = new Date().toISOString();

    if (formType === "application") {
      // Supabase (via the Express API) is the primary database — insert must succeed.
      const { data: { session } } = await getCurrentSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      const mirrorResponse = await fetch("/api/applications/mirror", {
        method: "POST",
        headers,
        body: JSON.stringify(formData),
      });
      if (!mirrorResponse.ok) {
        const payload = (await mirrorResponse.json().catch(() => null)) as { error?: string } | null;
        throw new SubmissionError(payload?.error || FORM_SUBMISSION_ERROR);
      }

      // Formspree is a secondary notification — best effort, never blocks success.
      try {
        await fetch(FORMSPREE_ENDPOINT, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ ...formData, formType, submittedAt }),
        });
      } catch {
        // Formspree is not the database source — ignore failures.
      }
    } else {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...formData, formType, submittedAt }),
      });
      if (!response.ok) throw new Error("Form submission failed");
    }
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    throw new Error(FORM_SUBMISSION_ERROR);
  } finally {
    submittingFormTypes.delete(formType);
  }
}
