"use server";

import {
  interpretVisualEvidence,
  type VisualEvidenceInput,
  type VisualAnalysisResult,
} from "@/lib/visual-interpretation";

/**
 * Server action to interpret visual evidence (screen recording or screenshot)
 * and generate structured understanding and an editable issue draft.
 */
export async function interpretVisualEvidenceAction(
  input: VisualEvidenceInput
): Promise<VisualAnalysisResult> {
  return interpretVisualEvidence(input);
}
