export const PRODUCT_RESEARCH_TEMPLATE = {
  id: "product-research",
  version: 1,
  title: "Product Research",
  category: "Product Research",
  difficulty: "Beginner–Intermediate",
  estimatedTime: "30–90 minutes",
  rewardMin: 20,
  rewardMax: 100,
  sections: [
    { id: "product-information", title: "Product Information", required: true },
    { id: "product-features", title: "Product Features", required: true },
    { id: "competitor-research", title: "Competitor Research", required: true },
    { id: "customer-research", title: "Customer Research", required: true },
    { id: "market-trends", title: "Market/Trend Research", required: true },
    { id: "final-analysis", title: "Final Analysis", required: true },
    { id: "submit-assignment", title: "Submit Assignment", required: false },
  ],
  evidence: {
    required: false,
    maxFileSizeBytes: 8 * 1024 * 1024,
    acceptedTypes: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  },
} as const;

export type ProductResearchSectionId = (typeof PRODUCT_RESEARCH_TEMPLATE.sections)[number]["id"];

export interface ProductResearchEvidence {
  sourceUrl: string;
  notes: string;
  filePath?: string;
  fileName?: string;
  mimeType?: string;
}

export interface ProductResearchCompetitor {
  name: string;
  productUrl: string;
  price: string;
  keyFeatures: string;
  advantages: string;
  disadvantages: string;
  notes: string;
}

export interface ProductResearchDraft {
  productInformation: {
    productName: string;
    sourceUrl: string;
    category: string;
    price: string;
    rating: string;
    otherInformation: string;
    evidence: ProductResearchEvidence[];
  };
  productFeatures: {
    mainFeatures: string;
    benefits: string;
    strengths: string;
    weaknesses: string;
    observations: string;
    evidence: ProductResearchEvidence[];
  };
  competitorResearch: {
    competitors: ProductResearchCompetitor[];
    evidence: ProductResearchEvidence[];
  };
  customerResearch: {
    positiveThemes: string;
    negativeThemes: string;
    complaints: string;
    praises: string;
    observations: string;
    evidence: ProductResearchEvidence[];
  };
  marketTrends: {
    trends: string;
    patterns: string;
    opportunities: string;
    risks: string;
    evidence: ProductResearchEvidence[];
  };
  finalAnalysis: {
    keyFindings: string;
    overallAssessment: string;
    recommendations: string;
    additionalNotes: string;
    evidence: ProductResearchEvidence[];
  };
}

export interface ContributorTaskSummary {
  id: string;
  assignmentId: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  lastActivityAt: string;
  submittedAt: string | null;
  productName: string | null;
  progress: number;
  currentStep: ProductResearchSectionId | string;
  changeRequest: string | null;
  rewardMin: number | null;
  rewardMax: number | null;
  templateId: string | null;
  templateVersion: number | null;
  assignment: {
    title: string;
    category: string;
    description: string;
    estimatedTime: string;
    reward: number;
  };
}

export interface ProductResearchTask extends ContributorTaskSummary {
  draft: ProductResearchDraft;
}
