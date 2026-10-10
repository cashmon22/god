import { describe, expect, it } from "vitest";
import { calculateResearchProgress } from "./research-tasks";
import type { ProductResearchDraft } from "../../shared/product-research";

function draft(): ProductResearchDraft {
  return {
    productInformation: { productName: "", sourceUrl: "", category: "", price: "", rating: "", otherInformation: "", evidence: [] },
    productFeatures: { mainFeatures: "", benefits: "", strengths: "", weaknesses: "", observations: "", evidence: [] },
    competitorResearch: { competitors: [], evidence: [] },
    customerResearch: { positiveThemes: "", negativeThemes: "", complaints: "", praises: "", observations: "", evidence: [] },
    marketTrends: { trends: "", patterns: "", opportunities: "", risks: "", evidence: [] },
    finalAnalysis: { keyFindings: "", overallAssessment: "", recommendations: "", additionalNotes: "", evidence: [] },
  };
}

describe("calculateResearchProgress", () => {
  it("reports zero progress until required section fields are complete", () => {
    expect(calculateResearchProgress(draft())).toEqual({ completedSections: 0, progress: 0, complete: [false, false, false, false, false, false] });
  });

  it("counts completed required sections and rounds six out of seven to 86 percent", () => {
    const completeDraft = draft();
    completeDraft.productInformation = { ...completeDraft.productInformation, productName: "Widget", sourceUrl: "https://example.test/widget", category: "Home", price: "$20" };
    completeDraft.productFeatures = { ...completeDraft.productFeatures, mainFeatures: "Feature", benefits: "Benefit", strengths: "Strong", weaknesses: "Weak" };
    completeDraft.competitorResearch.competitors = [{ name: "Rival", productUrl: "https://example.test/rival", price: "$25", keyFeatures: "Fast", advantages: "Good", disadvantages: "Cost", notes: "" }];
    completeDraft.customerResearch = { ...completeDraft.customerResearch, positiveThemes: "Likes", negativeThemes: "Dislikes", complaints: "Durability", praises: "Value" };
    completeDraft.marketTrends = { ...completeDraft.marketTrends, trends: "Trend", patterns: "Pattern", opportunities: "Opportunity", risks: "Risk" };
    completeDraft.finalAnalysis = { ...completeDraft.finalAnalysis, keyFindings: "Finding", overallAssessment: "Positive", recommendations: "Improve" };

    expect(calculateResearchProgress(completeDraft)).toEqual({ completedSections: 6, progress: 86, complete: [true, true, true, true, true, true] });
  });

  it("does not count whitespace as a completed response", () => {
    const partialDraft = draft();
    partialDraft.productInformation = { ...partialDraft.productInformation, productName: "  ", sourceUrl: "https://example.test/item", category: "Home", price: "$20" };

    expect(calculateResearchProgress(partialDraft).complete[0]).toBe(false);
  });
});
