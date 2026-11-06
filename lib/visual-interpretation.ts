import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { logger } from "@/lib/logger";

export type KeyframeSample = {
  label: string;
  dataUrl: string;
};

export type VisualEvidenceInput = {
  mediaType: "video" | "screenshot";
  durationSeconds?: number;
  clarification?: string;
  narration?: string; // Optional spoken voice narration recorded with microphone
  imageSample?: string; // base64 or data URL for screenshot
  frames?: KeyframeSample[]; // sequence of sampled frames across recording
  suggestedType?: string;
  previousUnderstanding?: string; // prior understanding if user is correcting AI
};

export type VisualInterpretationDetails = {
  observedBehavior: string;
  context: string;
  intent: string;
  isAmbiguous: boolean;
};

export type InterpretedIssueDraft = {
  title: string;
  description: string;
  suggestedType: "Bug" | "Feature" | "Improvement";
};

export type AIProvider = "anthropic" | "gemini" | "openrouter";

export type InterpretationTimings = {
  frameExtractionMs?: number;
  serverActionMs?: number;
  claudeApiMs?: number;
  providerApiMs?: number;
  provider?: AIProvider;
  validationMs?: number;
  totalServerMs?: number;
  totalClientMs?: number;
};

export type VisualAnalysisSuccess = {
  success: true;
  understanding: VisualInterpretationDetails;
  draft: InterpretedIssueDraft;
  provider?: AIProvider;
  timings?: InterpretationTimings;
};

export type VisualAnalysisError = {
  success: false;
  error: string;
  code: "NO_API_KEY" | "API_ERROR" | "PARSE_ERROR" | "TIMEOUT";
  provider?: AIProvider;
  fallbackDraft?: InterpretedIssueDraft;
  timings?: InterpretationTimings;
};

export type VisualAnalysisResult = VisualAnalysisSuccess | VisualAnalysisError;

const VisualAnalysisSchema = z.object({
  observedBehavior: z
    .string()
    .describe("Specific behavior, action sequence, or defect observed in the visual demonstration."),
  context: z
    .string()
    .describe("The detected page, component, or workflow where the issue took place."),
  intent: z
    .string()
    .describe("What the reporter is seeking to report, fix, or improve."),
  isAmbiguous: z
    .preprocess((val) => {
      if (typeof val === "string") return val.toLowerCase() === "true";
      return Boolean(val);
    }, z.boolean())
    .default(false)
    .describe("True if the user's intent is ambiguous and requires confirmation."),
  title: z
    .string()
    .describe("A concise, specific title for the issue (at most 12 words)."),
  summary: z
    .string()
    .describe("One or two sentences summarizing the problem or feature request."),
  stepsToReproduce: z
    .preprocess((val) => {
      if (Array.isArray(val)) {
        return val.map((item) => String(item).trim()).filter(Boolean);
      }
      if (typeof val === "string") {
        const lines = val
          .split("\n")
          .map((line) => line.replace(/^(\d+[\.\)]|\*|-)\s*/, "").trim())
          .filter(Boolean);
        return lines.length > 0 ? lines : [val.trim()];
      }
      return [];
    }, z.array(z.string()))
    .describe("2 to 5 sequential steps to reproduce or observe the behavior using specific UI element names."),
  expectedBehavior: z
    .string()
    .describe("Concrete description of expected system behavior."),
  actualBehavior: z
    .string()
    .describe("Precise description of what happened instead in the demonstration."),
  suggestedType: z
    .string()
    .optional()
    .transform((val) => normalizeSuggestedType(val) || "Bug")
    .describe("Suggested classification based on whether this is a bug or improvement."),
});

const SYSTEM_PROMPT = `You are an expert software engineer and product analyst evaluating visual bug reports and feature demonstrations in Ziki.
You analyze visual evidence (sequential keyframes from screen recordings or cropped screenshots), spoken voice narration, and user notes to synthesize specific, actionable issue drafts.

STRICT PRINCIPLES:
1. Ground every statement in observable evidence: Identify concrete elements, labels, buttons, navigation items, page headers, URLs, input fields, or icons shown in the frames.
2. Never invent details or assume unspecified backend architectures. Never use generic placeholders like "Perform the interactions", "Navigate to the relevant page", or "Observe the defect".
3. When the user provides spoken voice narration or written notes/corrections, synthesize them directly with the visual cues (e.g., if user says "Kebab menu in DM header is unresponsive", look at the header, identify the button, and document the exact reproduction path). The spoken narration explains what the user is attempting and what failed; the image keyframes confirm what occurred on screen.
4. If the visual demonstration is ambiguous (e.g., multiple rapid clicks, no clear error indication, or multiple interpretations possible), set isAmbiguous: true and specify in observedBehavior what needs user clarification.
5. Provide a concise, specific title (under 12 words) describing what went wrong or what should change.
6. Provide structured description formatted with standard markdown headings:
   - ## Summary: 1-2 concise sentences naming the component and the problem.
   - ## Steps to Reproduce: Numbered, concrete reproduction steps using exact UI element names.
   - ## Expected Behavior: Clear description of expected system behavior.
   - ## Actual Behavior: Precise description of what happened instead in the demonstration.`;

function normalizeSuggestedType(type?: string): "Bug" | "Feature" | "Improvement" | undefined {
  if (!type) return undefined;
  const lower = type.toLowerCase();
  if (lower === "feature") return "Feature";
  if (lower === "improvement" || lower === "improve") return "Improvement";
  return "Bug";
}

/**
 * Extracts concrete semantic components, actions, and expectations from user clarification.
 */
function parseClarificationDetails(clarification: string): {
  component: string;
  action: string;
  expected: string;
  actual: string;
} {
  const clean = clarification.trim().replace(/^[#*`>\-\s]+/, "");

  // Detect common patterns:
  // e.g. "Kebab menu in DM header is unresponsive on the desktop app"
  // e.g. "When clicking save button, the form resets instead of saving"
  // e.g. "Avatar image does not load after upload and remains blank"
  // e.g. "Actually, this is a color contrast / WCAG accessibility failure in dark mode"

  if (/contrast|accessibility|wcag|color/i.test(clean)) {
    return {
      component: "Dark mode color palette",
      action: "Inspect text and background color contrast in dark mode",
      expected: "Text contrast meets WCAG AA standards (minimum 4.5:1 ratio).",
      actual: clean,
    };
  }

  if (/badge|counter|filter/i.test(clean)) {
    return {
      component: "Filter tabs & badge counter",
      action: "Apply active filter tab",
      expected: "Badge counter updates dynamically to reflect filtered item count.",
      actual: clean,
    };
  }

  if (/unresponsive|not opening|doesn't open|fails to open/i.test(clean)) {
    const match = clean.match(/^(.+?)\s+(?:is unresponsive|does not open|doesn't open|fails to open)(.*)$/i);
    const comp = match ? match[1].trim() : "Interactive element";
    return {
      component: comp,
      action: `Click or trigger the ${comp}`,
      expected: `${comp} opens and presents relevant options or triggers its intended action.`,
      actual: clean,
    };
  }

  if (/reset|clear|discard/i.test(clean) && /save|submit/i.test(clean)) {
    return {
      component: "Form submission controls",
      action: "Submit changes via the save button",
      expected: "Form persists input values and displays confirmation.",
      actual: clean,
    };
  }

  if (/upload|avatar|image|file/i.test(clean)) {
    return {
      component: "File / image upload component",
      action: "Select and upload file",
      expected: "Uploaded asset loads and displays in the preview area.",
      actual: clean,
    };
  }

  // Fallback to parsed clauses
  const firstSentence = clean.split(/[.!?\n]/)[0].trim();
  return {
    component: firstSentence.length > 50 ? `${firstSentence.slice(0, 47)}…` : firstSentence,
    action: "Interact with the demonstrated interface element",
    expected: "Component behaves as expected without unexpected errors.",
    actual: clean,
  };
}

/**
 * Fallback generator when Claude API key is unavailable, offline, or if the API call fails.
 * Produces a specific, actionable draft and understanding from user clarification and visual context.
 */
export function generateFallbackDraft(input: VisualEvidenceInput): InterpretedIssueDraft {
  const clarification = input.clarification?.trim();
  const isVideo = input.mediaType === "video";
  const durationText = input.durationSeconds && input.durationSeconds > 0 ? ` (${input.durationSeconds}s)` : "";

  let title = "";
  let summary = "";
  let steps: string[] = [];
  let expected = "";
  let actual = "";

  if (clarification) {
    const details = parseClarificationDetails(clarification);
    const firstLine = clarification
      .split("\n")[0]
      .replace(/^[#*`>\-\s]+/, "")
      .trim();
    title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
    summary = clarification;

    steps = [
      `Navigate to the view containing ${details.component}.`,
      `${details.action}.`,
      "Observe the resulting system state and interface feedback.",
    ];
    expected = details.expected;
    actual = details.actual;
  } else {
    // No user clarification: generate grounded details based on media type
    if (isVideo) {
      title = `Issue observed during screen recording${durationText}`;
      summary = `Screen recording demonstrates an issue during user workflow${durationText}.`;
      steps = [
        "Open the application view shown at the start of the demonstration.",
        "Locate the target interface control shown in the recording.",
        "Click or trigger the control and observe the outcome.",
      ];
      expected = "The targeted control should respond to user input and complete its state transition.";
      actual = "The control does not respond as expected and fails to complete the demonstrated action.";
    } else {
      title = "Visual defect captured in area screenshot";
      summary = "Targeted area screenshot captures an interface defect in the selected region.";
      steps = [
        "Navigate to the view shown in the captured area.",
        "Inspect the highlighted interface component.",
        "Verify visual rendering and layout alignment.",
      ];
      expected = "Component should render with proper styling, alignment, and readable contrast.";
      actual = "Visual anomaly or layout defect is visible in the captured area.";
    }
  }

  const description = [
    "## Summary",
    summary,
    "",
    "## Steps to Reproduce",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Expected Behavior",
    expected,
    "",
    "## Actual Behavior",
    actual,
  ].join("\n");

  const isFeature =
    clarification?.toLowerCase().includes("feature") ||
    clarification?.toLowerCase().includes("improve") ||
    clarification?.toLowerCase().includes("add");

  return {
    title: title.slice(0, 200),
    description: description.slice(0, 5000),
    suggestedType: normalizeSuggestedType(input.suggestedType) || (isFeature ? "Improvement" : "Bug"),
  };
}

/**
 * Generates fallback analysis result with understanding details and structured draft.
 */
export function generateFallbackAnalysis(input: VisualEvidenceInput): VisualAnalysisSuccess {
  const isVideo = input.mediaType === "video";
  const durationText = input.durationSeconds && input.durationSeconds > 0 ? ` (${input.durationSeconds}s)` : "";
  const clarification = input.clarification?.trim();

  let observedBehavior = "";
  let context = "";
  let intent = "";
  let isAmbiguous = false;

  if (clarification) {
    const details = parseClarificationDetails(clarification);
    if (input.previousUnderstanding) {
      observedBehavior = `Corrected understanding: ${clarification}`;
      context = details.component;
      intent = "Submit issue with user-verified intent";
      isAmbiguous = false;
    } else {
      observedBehavior = clarification;
      context = details.component;
      intent = clarification.toLowerCase().includes("feature") || clarification.toLowerCase().includes("add")
        ? "Suggest a feature improvement"
        : "Report an unexpected defect";
      isAmbiguous = false;
    }
  } else {
    observedBehavior = isVideo
      ? `User recorded application interactions across screen recording${durationText}.`
      : "Visual elements highlighted in selected area capture.";
    context = isVideo ? "Screen demonstration workflow" : "Captured interface region";
    intent = "Demonstrate problem visually without typing full report.";
    isAmbiguous = isVideo && (input.durationSeconds ?? 0) > 15;
  }

  const draft = generateFallbackDraft(input);

  return {
    success: true,
    understanding: {
      observedBehavior,
      context,
      intent,
      isAmbiguous,
    },
    draft,
  };
}

function formatStructuredIssueDescription(parsed: {
  summary: string;
  stepsToReproduce: string[];
  expectedBehavior: string;
  actualBehavior: string;
}): string {
  return [
    "## Summary",
    parsed.summary,
    "",
    "## Steps to Reproduce",
    ...parsed.stepsToReproduce.map((step, idx) => `${idx + 1}. ${step}`),
    "",
    "## Expected Behavior",
    parsed.expectedBehavior,
    "",
    "## Actual Behavior",
    parsed.actualBehavior,
  ].join("\n");
}

function extractJsonObject(text: string): Record<string, unknown> {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const targetText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(targetText);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    const firstBrace = targetText.indexOf("{");
    const lastBrace = targetText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const braceSubstr = targetText.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(braceSubstr);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    }
    throw new Error("AI response did not contain a valid JSON object.");
  }
  return {};
}

/**
 * Normalizes raw model output to handle variations, unwraps nested response objects,
 * maps aliases, and fills missing fields from previous understanding and user clarification.
 */
export function normalizeRawAnalysisOutput(
  raw: unknown,
  input: VisualEvidenceInput
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const rawObj = raw as Record<string, unknown>;
  let unwrapped: Record<string, unknown> = { ...rawObj };

  // Handle nested objects commonly returned by LLMs (e.g. { understanding: {...}, draft: {...} })
  if (rawObj.understanding && typeof rawObj.understanding === "object" && !Array.isArray(rawObj.understanding)) {
    unwrapped = { ...unwrapped, ...(rawObj.understanding as Record<string, unknown>) };
  }
  if (rawObj.draft && typeof rawObj.draft === "object" && !Array.isArray(rawObj.draft)) {
    unwrapped = { ...unwrapped, ...(rawObj.draft as Record<string, unknown>) };
  }
  if (rawObj.result && typeof rawObj.result === "object" && !Array.isArray(rawObj.result)) {
    unwrapped = { ...unwrapped, ...(rawObj.result as Record<string, unknown>) };
  }
  if (rawObj.issue && typeof rawObj.issue === "object" && !Array.isArray(rawObj.issue)) {
    unwrapped = { ...unwrapped, ...(rawObj.issue as Record<string, unknown>) };
  }
  if (rawObj.data && typeof rawObj.data === "object" && !Array.isArray(rawObj.data)) {
    unwrapped = { ...unwrapped, ...(rawObj.data as Record<string, unknown>) };
  }
  if (rawObj.analysis && typeof rawObj.analysis === "object" && !Array.isArray(rawObj.analysis)) {
    unwrapped = { ...unwrapped, ...(rawObj.analysis as Record<string, unknown>) };
  }

  // Key aliases
  const observedBehavior =
    unwrapped.observedBehavior ??
    unwrapped.observed_behavior ??
    unwrapped.behavior ??
    unwrapped.observation ??
    unwrapped.defect;

  const context =
    unwrapped.context ??
    unwrapped.page ??
    unwrapped.component ??
    unwrapped.location ??
    unwrapped.feature;

  const intent =
    unwrapped.intent ??
    unwrapped.userIntent ??
    unwrapped.user_intent ??
    unwrapped.goal ??
    unwrapped.objective;

  const isAmbiguous =
    unwrapped.isAmbiguous ??
    unwrapped.is_ambiguous ??
    unwrapped.ambiguous;

  const title =
    unwrapped.title ??
    unwrapped.issueTitle ??
    unwrapped.issue_title ??
    unwrapped.name;

  const summary =
    unwrapped.summary ??
    unwrapped.problem ??
    unwrapped.description ??
    unwrapped.overview;

  const stepsToReproduce =
    unwrapped.stepsToReproduce ??
    unwrapped.steps_to_reproduce ??
    unwrapped.reproductionSteps ??
    unwrapped.reproduction_steps ??
    unwrapped.steps;

  const expectedBehavior =
    unwrapped.expectedBehavior ??
    unwrapped.expected_behavior ??
    unwrapped.expected ??
    unwrapped.expectedOutcome ??
    unwrapped.expected_outcome;

  const actualBehavior =
    unwrapped.actualBehavior ??
    unwrapped.actual_behavior ??
    unwrapped.actual ??
    unwrapped.actualOutcome ??
    unwrapped.actual_outcome;

  const suggestedType =
    unwrapped.suggestedType ??
    unwrapped.suggested_type ??
    unwrapped.type ??
    unwrapped.classification;

  // Fallback defaults from clarification and previous understanding
  const fallback = generateFallbackDraft(input);
  const clarificationDetails = input.clarification ? parseClarificationDetails(input.clarification) : null;

  return {
    observedBehavior:
      (typeof observedBehavior === "string" && observedBehavior.trim()) ||
      input.previousUnderstanding ||
      input.clarification ||
      fallback.title,
    context:
      (typeof context === "string" && context.trim()) ||
      clarificationDetails?.component ||
      "Application workflow",
    intent:
      (typeof intent === "string" && intent.trim()) ||
      (input.clarification?.toLowerCase().includes("feature")
        ? "Suggest a feature improvement"
        : "Report an unexpected defect"),
    isAmbiguous: isAmbiguous !== undefined ? isAmbiguous : false,
    title:
      (typeof title === "string" && title.trim()) ||
      fallback.title,
    summary:
      (typeof summary === "string" && summary.trim()) ||
      input.clarification ||
      fallback.title,
    stepsToReproduce:
      stepsToReproduce !== undefined
        ? stepsToReproduce
        : [
            `Navigate to ${clarificationDetails?.component || "the demonstrated view"}.`,
            clarificationDetails?.action || "Interact with the demonstrated interface component.",
            "Observe the resulting system state and interface feedback.",
          ],
    expectedBehavior:
      (typeof expectedBehavior === "string" && expectedBehavior.trim()) ||
      clarificationDetails?.expected ||
      "System should respond as expected without errors.",
    actualBehavior:
      (typeof actualBehavior === "string" && actualBehavior.trim()) ||
      clarificationDetails?.actual ||
      input.clarification ||
      "System behaves unexpectedly in the demonstration.",
    suggestedType: suggestedType || input.suggestedType || fallback.suggestedType,
  };
}

export function parseAndValidateAnalysisOutput(
  rawJsonStringOrObject: unknown,
  input: VisualEvidenceInput
): z.infer<typeof VisualAnalysisSchema> {
  let rawObj: unknown = rawJsonStringOrObject;
  if (typeof rawJsonStringOrObject === "string") {
    rawObj = extractJsonObject(rawJsonStringOrObject);
  }
  const normalized = normalizeRawAnalysisOutput(rawObj, input);
  return VisualAnalysisSchema.parse(normalized);
}

function buildInterpretationPrompt(input: VisualEvidenceInput): string {
  const parts: string[] = [
    `A user demonstrated an issue using a ${input.mediaType === "video" ? `screen recording (${input.durationSeconds ?? 0}s duration)` : "cropped area screenshot"}.`,
  ];

  if (input.narration?.trim()) {
    parts.push(
      `User's spoken voice narration during recording:\n"${input.narration.trim()}"\n(NOTE: Synthesize the user's spoken words with the on-screen keyframes to establish what happened.)`
    );
  }

  if (input.previousUnderstanding?.trim()) {
    parts.push(
      `REFINEMENT & CORRECTION CONTEXT:\nThe user reviewed an initial interpretation and provided a correction to refine it.\nPreviously established understanding:\n"${input.previousUnderstanding.trim()}"\nUser's clarifying correction notes:\n"${input.clarification?.trim() || ""}"\nINSTRUCTION: Refine and update the existing understanding and issue draft. Retain all established visual evidence and context from the demonstration (such as the page, components, and on-screen elements), while adjusting the specific steps, behaviors, or expectations to incorporate the user's clarification. Do NOT discard the visual context or generate unrelated details.`
    );
  } else if (input.clarification?.trim()) {
    parts.push(
      `User's clarifying notes or description:\n"${input.clarification.trim()}"`
    );
  }

  if (input.suggestedType) {
    parts.push(`Selected type hint: ${input.suggestedType}`);
  }

  parts.push(
    "Analyze the demonstration and output structured findings conforming to the required schema. Ensure ALL required fields are populated in the JSON output."
  );

  return parts.filter(Boolean).join("\n\n");
}

/**
 * Returns the configured AI provider for visual interpretation.
 * Defaults to "anthropic" if ZIKI_AI_PROVIDER (or VISUAL_AI_PROVIDER) is unset.
 */
export function getVisualAIProvider(): { provider: AIProvider; error?: string } {
  const raw = (process.env.ZIKI_AI_PROVIDER || process.env.VISUAL_AI_PROVIDER)?.trim().toLowerCase();
  if (!raw || raw === "anthropic" || raw === "claude") {
    return { provider: "anthropic" };
  }
  if (raw === "gemini" || raw === "google") {
    return { provider: "gemini" };
  }
  if (raw === "openrouter" || raw === "open-router") {
    return { provider: "openrouter" };
  }
  return {
    provider: "anthropic",
    error: `Unsupported AI provider "${raw}" configured in ZIKI_AI_PROVIDER. Supported options are "anthropic" (default), "gemini", or "openrouter".`,
  };
}

async function interpretWithAnthropic(
  input: VisualEvidenceInput,
  apiKey: string,
  model: string,
  serverStartTime: number
): Promise<VisualAnalysisResult> {
  const client = new Anthropic({ apiKey, timeout: 35_000, maxRetries: 1 });

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp"; data: string } }
  > = [];

  // Attach sequential video keyframes if available
  if (input.frames && input.frames.length > 0) {
    for (const frame of input.frames) {
      const match = frame.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (match) {
        const mediaType = match[1] === "jpg" ? "image/jpeg" : (match[1] === "webp" ? "image/webp" : "image/png");
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/png" | "image/jpeg" | "image/webp",
            data: match[2],
          },
        });
        content.push({
          type: "text",
          text: `[Demonstration Keyframe: ${frame.label}]`,
        });
      }
    }
  } else if (input.imageSample && input.imageSample.startsWith("data:image/")) {
    const match = input.imageSample.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (match) {
      const mediaType = match[1] === "jpg" ? "image/jpeg" : (match[1] === "webp" ? "image/webp" : "image/png");
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType as "image/png" | "image/jpeg" | "image/webp",
          data: match[2],
        },
      });
    }
  }

  content.push({ type: "text", text: buildInterpretationPrompt(input) });

  let parsedResult: z.infer<typeof VisualAnalysisSchema> | null = null;
  const claudeStartTime = performance.now();

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 2500,
      output_config: { effort: "low", format: zodOutputFormat(VisualAnalysisSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });
    if (response.parsed_output) {
      parsedResult = parseAndValidateAnalysisOutput(response.parsed_output, input);
    }
  } catch {
    const fallbackResponse = await client.messages.create({
      model,
      max_tokens: 2000,
      system: `${SYSTEM_PROMPT}\n\nIMPORTANT: Return ONLY a valid JSON object matching the required schema with keys: observedBehavior, context, intent, isAmbiguous, title, summary, stepsToReproduce, expectedBehavior, actualBehavior, suggestedType.`,
      messages: [{ role: "user", content }],
    });
    const textBlock = fallbackResponse.content.find((b) => b.type === "text");
    if (textBlock && textBlock.type === "text") {
      parsedResult = parseAndValidateAnalysisOutput(textBlock.text.trim(), input);
    }
  }

  const claudeApiMs = Math.round(performance.now() - claudeStartTime);
  const validationStartTime = performance.now();

  if (parsedResult) {
    const description = formatStructuredIssueDescription(parsedResult);
    const validationMs = Math.round(performance.now() - validationStartTime);
    const totalServerMs = Math.round(performance.now() - serverStartTime);

    logger.info("[visual-interpretation] Anthropic analysis completed successfully", {
      claudeApiMs,
      validationMs,
      totalServerMs,
      hasNarration: Boolean(input.narration?.trim()),
      frameCount: input.frames?.length ?? (input.imageSample ? 1 : 0),
    });

    return {
      success: true,
      provider: "anthropic",
      understanding: {
        observedBehavior: parsedResult.observedBehavior,
        context: parsedResult.context,
        intent: parsedResult.intent,
        isAmbiguous: parsedResult.isAmbiguous,
      },
      draft: {
        title: parsedResult.title.slice(0, 200),
        description: description.slice(0, 5000),
        suggestedType: parsedResult.suggestedType || normalizeSuggestedType(input.suggestedType) || "Bug",
      },
      timings: {
        claudeApiMs,
        providerApiMs: claudeApiMs,
        provider: "anthropic",
        validationMs,
        totalServerMs,
      },
    };
  }

  const totalServerMs = Math.round(performance.now() - serverStartTime);
  return {
    success: false,
    provider: "anthropic",
    error: "Visual analysis completed but could not extract structured issue details.",
    code: "PARSE_ERROR",
    fallbackDraft: generateFallbackDraft(input),
    timings: {
      claudeApiMs,
      providerApiMs: claudeApiMs,
      provider: "anthropic",
      validationMs: Math.round(performance.now() - validationStartTime),
      totalServerMs,
    },
  };
}

async function interpretWithGemini(
  input: VisualEvidenceInput,
  apiKey: string,
  model: string,
  serverStartTime: number
): Promise<VisualAnalysisResult> {
  const geminiStartTime = performance.now();

  type GeminiPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

  const parts: GeminiPart[] = [];

  // Attach sequential video keyframes
  if (input.frames && input.frames.length > 0) {
    for (const frame of input.frames) {
      const match = frame.dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (match) {
        const mimeType = match[1] === "jpg" ? "image/jpeg" : (match[1] === "webp" ? "image/webp" : "image/png");
        parts.push({
          inlineData: {
            mimeType,
            data: match[2],
          },
        });
        parts.push({
          text: `[Demonstration Keyframe: ${frame.label}]`,
        });
      }
    }
  } else if (input.imageSample && input.imageSample.startsWith("data:image/")) {
    const match = input.imageSample.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (match) {
      const mimeType = match[1] === "jpg" ? "image/jpeg" : (match[1] === "webp" ? "image/webp" : "image/png");
      parts.push({
        inlineData: {
          mimeType,
          data: match[2],
        },
      });
    }
  }

  parts.push({ text: buildInterpretationPrompt(input) });

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      maxOutputTokens: 2500,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Gemini API returned HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const json = await response.json();
  const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText || typeof candidateText !== "string") {
    throw new Error("Gemini returned an empty response or blocked content.");
  }

  const geminiApiMs = Math.round(performance.now() - geminiStartTime);
  const validationStartTime = performance.now();

  const parsedResult = parseAndValidateAnalysisOutput(candidateText, input);

  const description = formatStructuredIssueDescription(parsedResult);
  const validationMs = Math.round(performance.now() - validationStartTime);
  const totalServerMs = Math.round(performance.now() - serverStartTime);

  logger.info("[visual-interpretation] Gemini analysis completed successfully", {
    geminiApiMs,
    validationMs,
    totalServerMs,
    hasNarration: Boolean(input.narration?.trim()),
    frameCount: input.frames?.length ?? (input.imageSample ? 1 : 0),
  });

  return {
    success: true,
    provider: "gemini",
    understanding: {
      observedBehavior: parsedResult.observedBehavior,
      context: parsedResult.context,
      intent: parsedResult.intent,
      isAmbiguous: parsedResult.isAmbiguous,
    },
    draft: {
      title: parsedResult.title.slice(0, 200),
      description: description.slice(0, 5000),
      suggestedType: parsedResult.suggestedType || normalizeSuggestedType(input.suggestedType) || "Bug",
    },
    timings: {
      claudeApiMs: geminiApiMs,
      providerApiMs: geminiApiMs,
      provider: "gemini",
      validationMs,
      totalServerMs,
    },
  };
}

async function interpretWithOpenRouter(
  input: VisualEvidenceInput,
  apiKey: string,
  model: string,
  serverStartTime: number
): Promise<VisualAnalysisResult> {
  const openrouterStartTime = performance.now();

  type OpenRouterContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

  const contentParts: OpenRouterContentPart[] = [];

  // Attach sequential video keyframes
  if (input.frames && input.frames.length > 0) {
    for (const frame of input.frames) {
      if (frame.dataUrl.startsWith("data:image/")) {
        contentParts.push({
          type: "image_url",
          image_url: { url: frame.dataUrl },
        });
        contentParts.push({
          type: "text",
          text: `[Demonstration Keyframe: ${frame.label}]`,
        });
      }
    }
  } else if (input.imageSample && input.imageSample.startsWith("data:image/")) {
    contentParts.push({
      type: "image_url",
      image_url: { url: input.imageSample },
    });
  }

  contentParts.push({ type: "text", text: buildInterpretationPrompt(input) });

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT}\n\nIMPORTANT: Return ONLY a valid JSON object matching the required schema with keys:
- observedBehavior (string): specific behavior, action sequence, or defect observed
- context (string): detected page, component, or workflow where the issue took place
- intent (string): what the reporter is seeking to report, fix, or improve
- isAmbiguous (boolean): true if user intent is ambiguous and requires clarification, false otherwise
- title (string): concise, specific title for the issue (at most 12 words)
- summary (string): 1 to 2 sentences summarizing the problem or feature request
- stepsToReproduce (array of strings): 2 to 5 sequential reproduction steps as an array of strings
- expectedBehavior (string): concrete description of expected system behavior
- actualBehavior (string): precise description of what happened instead
- suggestedType (string): "Bug" | "Feature" | "Improvement"`,
      },
      {
        role: "user",
        content: contentParts,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 2500,
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://ziki.dev",
      "X-Title": "Ziki",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter API returned HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const json = await response.json();
  const choice = json.choices?.[0];
  const messageContent = choice?.message?.content;
  if (!messageContent || typeof messageContent !== "string") {
    logger.warn("[visual-interpretation] OpenRouter unexpected response:", json);
    throw new Error(`OpenRouter returned an empty response or invalid message structure: ${JSON.stringify(json).slice(0, 300)}`);
  }

  const openrouterApiMs = Math.round(performance.now() - openrouterStartTime);
  const validationStartTime = performance.now();

  const parsedResult = parseAndValidateAnalysisOutput(messageContent, input);

  const description = formatStructuredIssueDescription(parsedResult);
  const validationMs = Math.round(performance.now() - validationStartTime);
  const totalServerMs = Math.round(performance.now() - serverStartTime);

  logger.info("[visual-interpretation] OpenRouter analysis completed successfully", {
    openrouterApiMs,
    validationMs,
    totalServerMs,
    model,
    hasNarration: Boolean(input.narration?.trim()),
    frameCount: input.frames?.length ?? (input.imageSample ? 1 : 0),
  });

  return {
    success: true,
    provider: "openrouter",
    understanding: {
      observedBehavior: parsedResult.observedBehavior,
      context: parsedResult.context,
      intent: parsedResult.intent,
      isAmbiguous: parsedResult.isAmbiguous,
    },
    draft: {
      title: parsedResult.title.slice(0, 200),
      description: description.slice(0, 5000),
      suggestedType: parsedResult.suggestedType || normalizeSuggestedType(input.suggestedType) || "Bug",
    },
    timings: {
      claudeApiMs: openrouterApiMs,
      providerApiMs: openrouterApiMs,
      provider: "openrouter",
      validationMs,
      totalServerMs,
    },
  };
}

/**
 * Interprets visual evidence (screen recording keyframes or screenshot) and optional clarification
 * to generate a structured understanding and issue draft.
 *
 * Supports Anthropic Claude (default), Google Gemini, and OpenRouter via server-side configuration (ZIKI_AI_PROVIDER).
 */
export async function interpretVisualEvidence(input: VisualEvidenceInput): Promise<VisualAnalysisResult> {
  const serverStartTime = performance.now();
  const { provider, error } = getVisualAIProvider();

  if (error) {
    return {
      success: false,
      error: `Live AI interpretation configuration error: ${error}`,
      code: "API_ERROR",
      fallbackDraft: generateFallbackDraft(input),
      timings: {
        totalServerMs: Math.round(performance.now() - serverStartTime),
      },
    };
  }

  try {
    if (provider === "openrouter") {
      const apiKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) {
        return {
          success: false,
          provider: "openrouter",
          error: "Live AI interpretation is unavailable because OpenRouter is configured as the AI provider (ZIKI_AI_PROVIDER=openrouter), but no OPENROUTER_API_KEY was found.",
          code: "NO_API_KEY",
          fallbackDraft: generateFallbackDraft(input),
          timings: {
            totalServerMs: Math.round(performance.now() - serverStartTime),
          },
        };
      }
      const model = process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3.5-super-vl:free";
      return await interpretWithOpenRouter(input, apiKey, model, serverStartTime);
    }

    if (provider === "gemini") {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
      if (!apiKey) {
        return {
          success: false,
          provider: "gemini",
          error: "Live AI interpretation is unavailable because Gemini is configured as the AI provider (ZIKI_AI_PROVIDER=gemini), but no GEMINI_API_KEY (or GOOGLE_AI_API_KEY) was found.",
          code: "NO_API_KEY",
          fallbackDraft: generateFallbackDraft(input),
          timings: {
            totalServerMs: Math.round(performance.now() - serverStartTime),
          },
        };
      }
      const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
      return await interpretWithGemini(input, apiKey, model, serverStartTime);
    }

    // Default: Anthropic
    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ZIKI_CLAUDE_API_KEY)?.trim();
    if (!apiKey) {
      return {
        success: false,
        provider: "anthropic",
        error: "Live AI interpretation is unavailable because no Anthropic API key is configured (ANTHROPIC_API_KEY or ZIKI_CLAUDE_API_KEY).",
        code: "NO_API_KEY",
        fallbackDraft: generateFallbackDraft(input),
        timings: {
          totalServerMs: Math.round(performance.now() - serverStartTime),
        },
      };
    }

    const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";
    return await interpretWithAnthropic(input, apiKey, model, serverStartTime);
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : "Visual analysis failed";
    if (err instanceof z.ZodError || message.includes("ZodError") || message.includes("invalid_type")) {
      message = "AI response was incomplete or missing required fields.";
    }
    const totalServerMs = Math.round(performance.now() - serverStartTime);
    logger.warn(`[visual-interpretation] ${provider} execution failed:`, err);
    return {
      success: false,
      provider,
      error: `Live AI interpretation failed: ${message}`,
      code: "API_ERROR",
      fallbackDraft: generateFallbackDraft(input),
      timings: {
        provider,
        totalServerMs,
      },
    };
  }
}
