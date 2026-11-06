import { describe, expect, it } from "vitest";
import {
  generateFallbackAnalysis,
  generateFallbackDraft,
  interpretVisualEvidence,
  type VisualEvidenceInput,
} from "@/lib/visual-interpretation";

describe("visual-interpretation", () => {
  describe("generateFallbackDraft", () => {
    it("generates a structured draft from video input without clarification", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 15,
      };

      const result = generateFallbackDraft(input);
      expect(result.title).toContain("Issue observed during screen recording (15s)");
      expect(result.description).toContain("## Summary");
      expect(result.description).toContain("## Steps to Reproduce");
      expect(result.description).toContain("## Expected Behavior");
      expect(result.description).toContain("## Actual Behavior");
      expect(result.suggestedType).toBe("Bug");
    });

    it("generates a structured draft from screenshot input without clarification", () => {
      const input: VisualEvidenceInput = {
        mediaType: "screenshot",
      };

      const result = generateFallbackDraft(input);
      expect(result.title).toContain("Visual defect captured in area screenshot");
      expect(result.description).toContain("targeted area screenshot");
      expect(result.suggestedType).toBe("Bug");
    });

    it("incorporates user clarification into title, summary, and actual behavior", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 22,
        clarification: "Avatar image does not load after upload and remains blank",
      };

      const result = generateFallbackDraft(input);
      expect(result.title).toBe("Avatar image does not load after upload and remains blank");
      expect(result.description).toContain("Avatar image does not load after upload and remains blank");
      expect(result.description).toContain("## Steps to Reproduce");
    });

    it("identifies feature suggestions from clarification", () => {
      const input: VisualEvidenceInput = {
        mediaType: "screenshot",
        clarification: "Add an export to CSV feature on the table header",
      };

      const result = generateFallbackDraft(input);
      expect(result.suggestedType).toBe("Improvement");
      expect(result.title).toBe("Add an export to CSV feature on the table header");
    });
  });

  describe("generateFallbackAnalysis & understanding review", () => {
    it("produces structured understanding and detects ambiguous long recording without clarification", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 25,
      };

      const result = generateFallbackAnalysis(input);
      expect(result.understanding.observedBehavior).toContain("User recorded application interactions");
      expect(result.understanding.isAmbiguous).toBe(true);
      expect(result.draft.title).toBeTruthy();
    });

    it("resolves ambiguity when user clarifies their intent", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 25,
        clarification: "Kebab menu in DM header is unresponsive when clicked",
      };

      const result = generateFallbackAnalysis(input);
      expect(result.understanding.isAmbiguous).toBe(false);
      expect(result.understanding.observedBehavior).toContain("Kebab menu in DM header is unresponsive");
      expect(result.draft.title).toContain("Kebab menu in DM header is unresponsive");
    });

    it("incorporates user correction when AI misunderstands demonstration", () => {
      const input: VisualEvidenceInput = {
        mediaType: "screenshot",
        previousUnderstanding: "Dropdown menu alignment issue",
        clarification: "Actually, this is a color contrast / WCAG accessibility failure in dark mode",
      };

      const result = generateFallbackAnalysis(input);
      expect(result.understanding.observedBehavior).toContain("Corrected understanding");
      expect(result.understanding.observedBehavior).toContain("color contrast / WCAG accessibility failure");
      expect(result.draft.title).toContain("color contrast / WCAG accessibility failure");
    });
  });

  describe("interpretVisualEvidence with realistic scenarios", () => {
    it("processes sequential video keyframes gracefully when offline", async () => {
      const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
      const originalClaudeKey = process.env.ZIKI_CLAUDE_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ZIKI_CLAUDE_API_KEY;

      try {
        const input: VisualEvidenceInput = {
          mediaType: "video",
          durationSeconds: 12,
          frames: [
            { label: "Start of recording (t=1s)", dataUrl: "data:image/jpeg;base64,mock1" },
            { label: "Mid-interaction (t=6s)", dataUrl: "data:image/jpeg;base64,mock2" },
            { label: "Observed outcome (t=11s)", dataUrl: "data:image/jpeg;base64,mock3" },
          ],
          clarification: "Save button triggers page reload instead of saving form changes",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.understanding.observedBehavior).toContain("Save button triggers page reload");
        expect(result.draft.title).toBe("Save button triggers page reload instead of saving form changes");
        expect(result.draft.description).toContain("## Steps to Reproduce");
        expect(result.draft.description).toContain("## Expected Behavior");
        expect(result.draft.description).toContain("## Actual Behavior");
      } finally {
        if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
        if (originalClaudeKey) process.env.ZIKI_CLAUDE_API_KEY = originalClaudeKey;
      }
    });
  });
});
