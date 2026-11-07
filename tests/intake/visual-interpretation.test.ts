import { describe, expect, it, vi } from "vitest";
import {
  generateFallbackAnalysis,
  generateFallbackDraft,
  getVisualAIProvider,
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
      expect(result.description.toLowerCase()).toContain("targeted area screenshot");
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

    it("context-specifically interprets broken image on existing product listing without copying conversational text or generating file-upload steps", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 10,
        clarification: "I'm reporting the broken image on the whambar product listing",
      };

      const result = generateFallbackDraft(input);
      // Title must be concise and objective without conversational prefixes
      expect(result.title).toBe("Broken image on whambar product listing");
      expect(result.title).not.toContain("I'm reporting");

      // Description must contain context-specific product listing steps, not file upload
      expect(result.description).toContain("whambar product listing");
      expect(result.description).not.toContain("upload");
      expect(result.description).not.toContain("Upload");

      // Verify sections are distinct and each serves its intended purpose
      expect(result.description).toContain("## Summary");
      expect(result.description).toContain("The whambar product listing displays a broken or missing image");
      expect(result.description).toContain("## Steps to Reproduce");
      expect(result.description).toContain("Navigate to the view containing the whambar product listing.");
      expect(result.description).toContain("## Expected Behavior");
      expect(result.description).toContain("The whambar product listing should display a valid, properly rendered image.");
      expect(result.description).toContain("## Actual Behavior");
      expect(result.description).toContain("The product image fails to load and displays a broken image icon");
      expect(result.description).not.toContain("I'm reporting");
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

    it("refines understanding and draft for broken product image correction without copying conversational phrases", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 8,
        previousUnderstanding: "User clicked on product listing. Context: Products page. Intent: View product details.",
        clarification: "I'm reporting the broken image on the whambar product listing",
      };

      const result = generateFallbackAnalysis(input);
      expect(result.understanding.context).toBe("whambar product listing");
      expect(result.draft.title).toBe("Broken image on whambar product listing");
      expect(result.draft.title).not.toContain("I'm reporting");
      expect(result.draft.description).toContain("## Steps to Reproduce");
      expect(result.draft.description).toContain("whambar product listing");
      expect(result.draft.description).not.toContain("file upload");
      expect(result.draft.description).not.toContain("upload");
    });

    it("preserves Wham Bars product card context when user provides brief 'the image is broken.' clarification", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 10,
        previousUnderstanding:
          "Observed behavior: Wham Bars product card with description, price (£0.15), and Add to Basket button has a large empty space. Context: Wham Bars product card. Intent: Ambiguous intent.",
        clarification: "the image is broken.",
      };

      const result = generateFallbackAnalysis(input);

      // Context must be preserved from previous understanding
      expect(result.understanding.context).toBe("Wham Bars product card");
      expect(result.understanding.isAmbiguous).toBe(false);

      // Title must combine defect with identified component
      expect(result.draft.title).toBe("Broken image on Wham Bars product card");
      expect(result.draft.title).not.toBe("The image is broken");

      // Summary must describe the defect in context, not echo user text verbatim
      expect(result.draft.description).toContain("## Summary");
      expect(result.draft.description).toContain(
        "The Wham Bars product card displays a broken or missing image instead of the expected product photo."
      );
      expect(result.draft.description).not.toMatch(/^## Summary\s*\nthe image is broken/i);

      // Reproduction steps must navigate to listing and card with price/button, not invent file uploads
      expect(result.draft.description).toContain("## Steps to Reproduce");
      expect(result.draft.description).toContain("Navigate to the product listing containing the Wham Bars product card.");
      expect(result.draft.description).toContain("Locate the Wham Bars product card (price £0.15 with Add to Basket button).");
      expect(result.draft.description).toContain("Observe that the product image area inside the card is blank or broken.");
      expect(result.draft.description).not.toContain("upload");
      expect(result.draft.description).not.toContain("file selector");

      // Expected and actual must be context-specific
      expect(result.draft.description).toContain("## Expected Behavior");
      expect(result.draft.description).toContain(
        "The Wham Bars product card should display a valid, properly rendered image."
      );
      expect(result.draft.description).toContain("## Actual Behavior");
      expect(result.draft.description).toContain(
        "The Wham Bars product card image fails to load, leaving an empty area inside the product card."
      );
      expect(result.draft.description).not.toMatch(/^## Actual Behavior\s*\nthe image is broken/i);
    });
  });

  describe("interpretVisualEvidence with realistic scenarios", () => {
    it("reports clear error status without silent fallback when offline or key is missing", async () => {
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
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.code).toBe("NO_API_KEY");
          expect(result.error).toContain("no Anthropic API key is configured");
          expect(result.fallbackDraft).toBeDefined();
          expect(result.fallbackDraft?.title).toBe("Save button triggers page reload instead of saving form changes");
        }
      } finally {
        if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
        if (originalClaudeKey) process.env.ZIKI_CLAUDE_API_KEY = originalClaudeKey;
      }
    });

    it("synthesizes spoken voice narration into fallback drafts", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 10,
        narration: "When clicking the kebab menu in the DM header, nothing opens",
        clarification: "Kebab menu in DM header is unresponsive",
      };

      const result = generateFallbackAnalysis(input);
      expect(result.success).toBe(true);
      expect(result.understanding.observedBehavior).toContain("Kebab menu in DM header is unresponsive");
      expect(result.draft.title).toContain("Kebab menu in DM header is unresponsive");
    });

    it("grounds fallback drafts in spoken voice narration when clarification is absent", () => {
      const input: VisualEvidenceInput = {
        mediaType: "video",
        durationSeconds: 15,
        narration: "When clicking the delete button on the comment, the modal does not appear",
      };

      const result = generateFallbackAnalysis(input);
      expect(result.success).toBe(true);
      expect(result.understanding.observedBehavior).toContain("delete button on the comment");
      expect(result.draft.title).toContain("delete button on the comment");
      expect(result.draft.description).toContain("delete button on the comment");
      expect(result.draft.description).not.toContain("Locate the target interface control shown in the recording");
    });
  });

  describe("AI provider selection & Google Gemini integration", () => {
    it("defaults to Anthropic when VISUAL_AI_PROVIDER is unset", () => {
      const original = process.env.VISUAL_AI_PROVIDER;
      delete process.env.VISUAL_AI_PROVIDER;
      try {
        const { provider, error } = getVisualAIProvider();
        expect(provider).toBe("anthropic");
        expect(error).toBeUndefined();
      } finally {
        if (original) process.env.VISUAL_AI_PROVIDER = original;
      }
    });

    it("selects Gemini when VISUAL_AI_PROVIDER=gemini", () => {
      const original = process.env.VISUAL_AI_PROVIDER;
      process.env.VISUAL_AI_PROVIDER = "gemini";
      try {
        const { provider, error } = getVisualAIProvider();
        expect(provider).toBe("gemini");
        expect(error).toBeUndefined();
      } finally {
        if (original) process.env.VISUAL_AI_PROVIDER = original;
        else delete process.env.VISUAL_AI_PROVIDER;
      }
    });

    it("reports an error for invalid provider configurations", () => {
      const original = process.env.VISUAL_AI_PROVIDER;
      process.env.VISUAL_AI_PROVIDER = "unsupported-provider";
      try {
        const { provider, error } = getVisualAIProvider();
        expect(provider).toBe("anthropic");
        expect(error).toContain("Unsupported AI provider");
      } finally {
        if (original) process.env.VISUAL_AI_PROVIDER = original;
        else delete process.env.VISUAL_AI_PROVIDER;
      }
    });

    it("reports clear error status when Gemini is selected but GEMINI_API_KEY is missing", async () => {
      const origProvider = process.env.VISUAL_AI_PROVIDER;
      const origGeminiKey = process.env.GEMINI_API_KEY;
      const origGoogleKey = process.env.GOOGLE_AI_API_KEY;

      process.env.VISUAL_AI_PROVIDER = "gemini";
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          clarification: "Dropdown menu disappears when clicking scrollbar",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.code).toBe("NO_API_KEY");
          expect(result.provider).toBe("gemini");
          expect(result.error).toContain("Gemini is configured as the AI provider");
          expect(result.error).toContain("no GEMINI_API_KEY");
        }
      } finally {
        if (origProvider) process.env.VISUAL_AI_PROVIDER = origProvider;
        else delete process.env.VISUAL_AI_PROVIDER;
        if (origGeminiKey) process.env.GEMINI_API_KEY = origGeminiKey;
        if (origGoogleKey) process.env.GOOGLE_AI_API_KEY = origGoogleKey;
      }
    });

    it("interprets visual evidence via Gemini with structured response and timings", async () => {
      const origProvider = process.env.VISUAL_AI_PROVIDER;
      const origGeminiKey = process.env.GEMINI_API_KEY;

      process.env.VISUAL_AI_PROVIDER = "gemini";
      process.env.GEMINI_API_KEY = "test-gemini-key";

      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    observedBehavior: "Save button is disabled after entering valid form values",
                    context: "Project Settings > Integrations",
                    intent: "Report form validation failure",
                    isAmbiguous: false,
                    title: "Save button remains disabled with valid settings input",
                    summary: "The Save button on the Integrations settings page does not enable after entering valid credentials.",
                    stepsToReproduce: [
                      "Navigate to Project Settings > Integrations",
                      "Enter a valid webhook URL into the Endpoint input",
                      "Observe that the Save changes button remains disabled",
                    ],
                    expectedBehavior: "Save changes button should become enabled once required fields are filled.",
                    actualBehavior: "Save changes button remains grayed out and disabled.",
                    suggestedType: "Bug",
                  }),
                },
              ],
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGeminiResponse,
      });
      globalThis.fetch = mockFetch;

      try {
        const input: VisualEvidenceInput = {
          mediaType: "video",
          durationSeconds: 8,
          frames: [
            { label: "Start of recording (t=1s)", dataUrl: "data:image/jpeg;base64,frame1" },
            { label: "Observed outcome (t=7s)", dataUrl: "data:image/jpeg;base64,frame2" },
          ],
          narration: "I entered the webhook URL but Save button stays disabled",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.provider).toBe("gemini");
          expect(result.understanding.observedBehavior).toBe("Save button is disabled after entering valid form values");
          expect(result.understanding.context).toBe("Project Settings > Integrations");
          expect(result.understanding.isAmbiguous).toBe(false);
          expect(result.draft.title).toBe("Save button remains disabled with valid settings input");
          expect(result.draft.description).toContain("## Summary");
          expect(result.draft.description).toContain("## Steps to Reproduce");
          expect(result.draft.description).toContain("## Expected Behavior");
          expect(result.draft.description).toContain("## Actual Behavior");
          expect(result.timings?.provider).toBe("gemini");
          expect(result.timings?.providerApiMs).toBeDefined();
        }

        // Verify that fetch was called with the Gemini endpoint and API key
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = mockFetch.mock.calls[0];
        expect(calledUrl).toContain("generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent");
        expect(calledUrl).toContain("key=test-gemini-key");
        expect(calledInit.method).toBe("POST");

        // Verify request body contains systemInstruction, contents with inlineData and prompt
        const parsedBody = JSON.parse(calledInit.body as string);
        expect(parsedBody.systemInstruction.parts[0].text).toContain("You are an expert software engineer");
        expect(parsedBody.contents[0].parts.some((p: { inlineData?: { data: string } }) => p.inlineData?.data === "frame1")).toBe(true);
        expect(parsedBody.generationConfig.responseMimeType).toBe("application/json");
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.VISUAL_AI_PROVIDER = origProvider;
        else delete process.env.VISUAL_AI_PROVIDER;
        if (origGeminiKey) process.env.GEMINI_API_KEY = origGeminiKey;
        else delete process.env.GEMINI_API_KEY;
      }
    });
  });

  describe("OpenRouter multimodal AI integration", () => {
    it("selects OpenRouter when ZIKI_AI_PROVIDER=openrouter", () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      process.env.ZIKI_AI_PROVIDER = "openrouter";
      try {
        const { provider, error } = getVisualAIProvider();
        expect(provider).toBe("openrouter");
        expect(error).toBeUndefined();
      } finally {
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
      }
    });

    it("reports clear error status when OpenRouter is selected but OPENROUTER_API_KEY is missing", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      delete process.env.OPENROUTER_API_KEY;

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          clarification: "Avatar image upload silently fails without notification",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.code).toBe("NO_API_KEY");
          expect(result.provider).toBe("openrouter");
          expect(result.error).toContain("OpenRouter is configured as the AI provider");
          expect(result.error).toContain("no OPENROUTER_API_KEY was found");
        }
      } finally {
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
      }
    });

    it("interprets visual evidence via OpenRouter with structured response and timings", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;
      const origModel = process.env.OPENROUTER_MODEL;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";
      delete process.env.OPENROUTER_MODEL;

      const mockOpenRouterResponse = {
        id: "gen-12345",
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                observedBehavior: "Crop box does not maintain aspect ratio when resizing from bottom-right corner",
                context: "Add Idea > Screenshot Cropper",
                intent: "Report interactive cropping defect",
                isAmbiguous: false,
                title: "Screenshot crop handle does not lock aspect ratio",
                summary: "Resizing the crop bounding box from the corner handle distorts selection bounds instead of scaling isotropically.",
                stepsToReproduce: [
                  "Open Add Idea modal and select Capture screenshot",
                  "Drag on canvas to define initial crop region",
                  "Drag bottom-right corner handle to resize",
                  "Observe distorted non-uniform aspect ratio",
                ],
                expectedBehavior: "Corner drag should maintain selected aspect ratio or scale smoothly without distortion.",
                actualBehavior: "Crop rectangle distorts and bounds drift from pointer position.",
                suggestedType: "Bug",
              }),
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenRouterResponse,
      });
      globalThis.fetch = mockFetch;

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          imageSample: "data:image/jpeg;base64,mockCropData",
          clarification: "Crop handle distorts bounding box",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.provider).toBe("openrouter");
          expect(result.understanding.observedBehavior).toBe("Crop box does not maintain aspect ratio when resizing from bottom-right corner");
          expect(result.understanding.context).toBe("Add Idea > Screenshot Cropper");
          expect(result.understanding.isAmbiguous).toBe(false);
          expect(result.draft.title).toBe("Screenshot crop handle does not lock aspect ratio");
          expect(result.draft.description).toContain("## Summary");
          expect(result.draft.description).toContain("## Steps to Reproduce");
          expect(result.draft.description).toContain("## Expected Behavior");
          expect(result.draft.description).toContain("## Actual Behavior");
          expect(result.timings?.provider).toBe("openrouter");
          expect(result.timings?.providerApiMs).toBeDefined();
        }

        // Verify OpenRouter endpoint and headers
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = mockFetch.mock.calls[0];
        expect(calledUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
        expect(calledInit.method).toBe("POST");
        expect(calledInit.headers["Authorization"]).toBe("Bearer sk-or-v1-mock-key");
        expect(calledInit.headers["HTTP-Referer"]).toBe("https://ziki.dev");

        // Verify request body
        const parsedBody = JSON.parse(calledInit.body as string);
        expect(parsedBody.model).toBe("nvidia/nemotron-3.5-super-vl:free");
        expect(parsedBody.response_format).toEqual({ type: "json_object" });
        expect(parsedBody.messages[0].role).toBe("system");
        expect(parsedBody.messages[1].role).toBe("user");
        expect(parsedBody.messages[1].content.some((c: { type: string; image_url?: { url: string } }) => c.type === "image_url" && c.image_url?.url.includes("mockCropData"))).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
        if (origModel) process.env.OPENROUTER_MODEL = origModel;
      }
    });

    it("handles string or multiline stepsToReproduce and string isAmbiguous gracefully", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";

      const mockOpenRouterResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                observedBehavior: "Idea list does not load",
                context: "Ideas page",
                intent: "Fix idea loading",
                isAmbiguous: "true",
                title: "Idea list fails to display items",
                summary: "Ideas are not rendered on page load.",
                stepsToReproduce: "1. Open ideas page\n2. Wait for fetch\n3. Note empty list",
                expectedBehavior: "Ideas should render",
                actualBehavior: "Empty list is shown",
                suggestedType: "defect",
              }),
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockOpenRouterResponse,
      });

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          clarification: "Ideas are not loading",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.understanding.isAmbiguous).toBe(true);
          expect(result.draft.suggestedType).toBe("Bug");
          expect(result.draft.description).toContain("1. Open ideas page");
          expect(result.draft.description).toContain("2. Wait for fetch");
          expect(result.draft.description).toContain("3. Note empty list");
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("refines interpretation when user provides clarification and unrolls nested understanding/draft objects", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";

      // Common nested structure returned by LLMs when asked to refine
      const mockNestedResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                understanding: {
                  observedBehavior: "Idea list shows empty state in Dark mode",
                  context: "Ideas page / Theme settings",
                  intent: "Report dark mode display defect",
                  isAmbiguous: false,
                },
                draft: {
                  title: "Idea list appears empty in Dark mode",
                  summary: "In Dark mode, the ideas list does not render existing ideas.",
                  stepsToReproduce: [
                    "Toggle Dark mode in settings",
                    "Navigate to the Ideas page",
                    "Observe empty state",
                  ],
                  expectedBehavior: "Ideas should render in both Dark and Light mode",
                  actualBehavior: "Ideas render in Light mode but not Dark mode",
                  suggestedType: "Bug",
                },
              }),
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockNestedResponse,
      });

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          previousUnderstanding: "Idea list shows empty state",
          clarification: "This only happens when Dark mode is enabled",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.understanding.observedBehavior).toBe("Idea list shows empty state in Dark mode");
          expect(result.understanding.context).toBe("Ideas page / Theme settings");
          expect(result.draft.title).toBe("Idea list appears empty in Dark mode");
          expect(result.draft.description).toContain("## Steps to Reproduce");
          expect(result.draft.description).toContain("Toggle Dark mode in settings");
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("fills missing fields during clarification updates without throwing schema undefined errors", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";

      // Model returned only a partial update omitting context, intent, expectedBehavior
      const mockPartialResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                observedBehavior: "Actually, this only occurs in dark mode",
                title: "Dark mode list render defect",
                summary: "Dark mode does not display list items.",
                actualBehavior: "List is empty in dark mode",
              }),
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPartialResponse,
      });

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
          previousUnderstanding: "Observed behavior: List is empty. Context: Project list. Intent: Fix list.",
          clarification: "Actually, this only occurs in dark mode",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.understanding.observedBehavior).toBe("Actually, this only occurs in dark mode");
          expect(result.understanding.context).toBeTruthy();
          expect(result.understanding.intent).toBeTruthy();
          expect(result.draft.title).toBe("Dark mode list render defect");
          expect(result.draft.description).toContain("## Steps to Reproduce");
          expect(result.draft.description).toContain("## Expected Behavior");
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("recovers JSON from reasoning when message content is null or empty", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";

      const mockReasoningResponse = {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: null,
              reasoning:
                "Thinking process... The user showed a broken button.\n" +
                JSON.stringify({
                  observedBehavior: "Submit button stays disabled",
                  context: "Add Idea modal",
                  intent: "Enable submit button",
                  isAmbiguous: false,
                  title: "Submit button remains disabled after required fields filled",
                  summary: "The submit button does not activate.",
                  stepsToReproduce: ["Fill in form", "Observe button"],
                  expectedBehavior: "Button activates",
                  actualBehavior: "Button stays disabled",
                  suggestedType: "Bug",
                }),
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockReasoningResponse,
      });

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.understanding.observedBehavior).toBe("Submit button stays disabled");
          expect(result.draft.title).toBe("Submit button remains disabled after required fields filled");
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });

    it("handles OpenRouter error payloads gracefully without throwing generic empty structure error", async () => {
      const origProvider = process.env.ZIKI_AI_PROVIDER;
      const origKey = process.env.OPENROUTER_API_KEY;

      process.env.ZIKI_AI_PROVIDER = "openrouter";
      process.env.OPENROUTER_API_KEY = "sk-or-v1-mock-key";

      const mockErrorResponse = {
        error: {
          message: "Provider nvidia returned upstream error: model unavailable",
          code: 503,
        },
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockErrorResponse,
      });

      try {
        const input: VisualEvidenceInput = {
          mediaType: "screenshot",
        };

        const result = await interpretVisualEvidence(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error).toContain("Provider nvidia returned upstream error");
        }
      } finally {
        globalThis.fetch = originalFetch;
        if (origProvider) process.env.ZIKI_AI_PROVIDER = origProvider;
        else delete process.env.ZIKI_AI_PROVIDER;
        if (origKey) process.env.OPENROUTER_API_KEY = origKey;
        else delete process.env.OPENROUTER_API_KEY;
      }
    });
  });
});
