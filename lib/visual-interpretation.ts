import Anthropic from "@anthropic-ai/sdk";
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

export type VisualAnalysisResult = {
  understanding: VisualInterpretationDetails;
  draft: InterpretedIssueDraft;
};

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
    .boolean()
    .default(false)
    .describe("True if the user's intent is ambiguous and requires confirmation."),
  title: z
    .string()
    .describe("A concise, specific title for the issue (at most 12 words)."),
  summary: z
    .string()
    .describe("One or two sentences summarizing the problem or feature request."),
  stepsToReproduce: z
    .array(z.string())
    .describe("2 to 5 sequential steps to reproduce or observe the behavior."),
  expectedBehavior: z
    .string()
    .describe("What should have happened or what is expected by the user."),
  actualBehavior: z
    .string()
    .describe("What actually occurred or what defect is demonstrated."),
  suggestedType: z
    .enum(["Bug", "Feature", "Improvement"])
    .default("Bug")
    .describe("Suggested classification based on whether this is a bug or improvement."),
});

const SYSTEM_PROMPT = `You analyze visual demonstrations (screen recordings with sequential keyframes, or cropped screenshots) and user notes from a product tracker to generate clear, structured, actionable issue descriptions.

Follow these rules:
1. Genuinely interpret the visual evidence: identify specific UI elements, pages, buttons, modals, error states, and user actions shown in the image frames.
2. If the user provided clarifying notes or corrected a previous misunderstanding, prioritize their stated intent while grounding it in what was visually shown.
3. If the demonstration contains ambiguous intent (e.g. multiple actions with unclear outcomes), set isAmbiguous: true and identify what needs confirmation.
4. Structure the final description with standard markdown headings:
   - ## Summary
   - ## Steps to Reproduce
   - ## Expected Behavior
   - ## Actual Behavior
5. Keep the title specific, actionable, and under 12 words (e.g. "Dropdown menu closes unexpectedly when selecting option").`;

function normalizeSuggestedType(type?: string): "Bug" | "Feature" | "Improvement" | undefined {
  if (!type) return undefined;
  const lower = type.toLowerCase();
  if (lower === "feature") return "Feature";
  if (lower === "improvement" || lower === "improve") return "Improvement";
  return "Bug";
}

/**
 * Fallback generator when Claude API key is unavailable, offline, or if the API call fails.
 * Produces a structured draft and understanding from user clarification and visual context.
 */
export function generateFallbackDraft(input: VisualEvidenceInput): InterpretedIssueDraft {
  const clarification = input.clarification?.trim();
  const isVideo = input.mediaType === "video";
  const durationText = input.durationSeconds && input.durationSeconds > 0 ? ` (${input.durationSeconds}s)` : "";

  let title = "";
  if (clarification) {
    const firstLine = clarification
      .split("\n")[0]
      .replace(/^[#*`>\-\s]+/, "")
      .trim();
    title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
    if (title.length < 3) {
      title = isVideo
        ? `Issue observed in screen recording${durationText}`
        : "Visual issue captured in screenshot";
    }
  } else {
    title = isVideo
      ? `Issue observed during screen recording${durationText}`
      : "Visual defect captured in area screenshot";
  }

  const summary = clarification
    ? clarification
    : `Issue demonstrated visually via ${isVideo ? "screen recording" : "targeted area screenshot"}${durationText}.`;

  const steps = [
    "Navigate to the relevant application page or workflow.",
    isVideo
      ? "Perform the sequence of interactions demonstrated in the recording."
      : "Inspect the interface element highlighted in the captured screenshot.",
    "Observe the resulting defect or unexpected behavior.",
  ];

  const expected = "The interface functions smoothly without errors, layout defects, or unexpected interruptions.";
  const actual = clarification
    ? `As observed in the demonstration: ${clarification}`
    : `The issue demonstrated in the ${isVideo ? "recording" : "captured area"}.`;

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
export function generateFallbackAnalysis(input: VisualEvidenceInput): VisualAnalysisResult {
  const isVideo = input.mediaType === "video";
  const durationText = input.durationSeconds && input.durationSeconds > 0 ? ` (${input.durationSeconds}s)` : "";
  const clarification = input.clarification?.trim();

  let observedBehavior = "";
  let context = "";
  let intent = "";
  let isAmbiguous = false;

  if (clarification) {
    if (input.previousUnderstanding) {
      observedBehavior = `Corrected understanding: ${clarification}`;
      context = "Application workflow updated based on user clarification";
      intent = "Submit issue with verified user intent";
      isAmbiguous = false;
    } else {
      observedBehavior = `Observed demonstration: ${clarification}`;
      context = isVideo ? "Screen demonstration workflow" : "Captured visual area";
      intent = clarification.toLowerCase().includes("feature") || clarification.toLowerCase().includes("add")
        ? "Suggest a feature improvement"
        : "Report an unexpected defect";
      isAmbiguous = false;
    }
  } else {
    observedBehavior = isVideo
      ? `User recorded application interactions across ${durationText}.`
      : "Visual elements highlighted in selected area capture.";
    context = isVideo ? "Screen recording session" : "Interface component";
    intent = "Visually demonstrate problem without typing full report.";
    isAmbiguous = isVideo && (input.durationSeconds ?? 0) > 15;
  }

  const draft = generateFallbackDraft(input);

  return {
    understanding: {
      observedBehavior,
      context,
      intent,
      isAmbiguous,
    },
    draft,
  };
}

/**
 * Interprets visual evidence (screen recording keyframes or screenshot) and optional clarification
 * to generate a structured understanding and issue draft.
 */
export async function interpretVisualEvidence(input: VisualEvidenceInput): Promise<VisualAnalysisResult> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ZIKI_CLAUDE_API_KEY)?.trim();
  if (!apiKey) {
    return generateFallbackAnalysis(input);
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";

  try {
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
      // Single screenshot or sample frame
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

    const promptDetails = [
      `A user demonstrated an issue using a ${input.mediaType === "video" ? `screen recording (${input.durationSeconds ?? 0}s duration)` : "cropped area screenshot"}.`,
      input.previousUnderstanding ? `NOTE: The user previously reviewed an initial interpretation and provided a correction.\nPrevious understanding:\n"${input.previousUnderstanding}"` : "",
      input.clarification?.trim() ? `User's clarifying notes or correction:\n"${input.clarification.trim()}"` : "The user did not provide additional written notes.",
      input.suggestedType ? `Selected type hint: ${input.suggestedType}` : "",
      "Analyze the demonstration and output a JSON object with: observedBehavior, context, intent, isAmbiguous (boolean), title, summary, stepsToReproduce (array), expectedBehavior, actualBehavior, suggestedType ('Bug'|'Feature'|'Improvement').",
    ]
      .filter(Boolean)
      .join("\n\n");

    content.push({ type: "text", text: promptDetails });

    const response = await client.messages.create({
      model,
      max_tokens: 1800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      return generateFallbackAnalysis(input);
    }

    const rawText = textContent.text.trim();
    let parsedJson: z.infer<typeof VisualAnalysisSchema> | null = null;

    try {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawText];
      const parsed = JSON.parse(jsonMatch[1] || rawText);
      parsedJson = VisualAnalysisSchema.parse(parsed);
    } catch {
      // direct parse failed, fall back
    }

    if (parsedJson) {
      const description = [
        "## Summary",
        parsedJson.summary,
        "",
        "## Steps to Reproduce",
        ...parsedJson.stepsToReproduce.map((step, idx) => `${idx + 1}. ${step}`),
        "",
        "## Expected Behavior",
        parsedJson.expectedBehavior,
        "",
        "## Actual Behavior",
        parsedJson.actualBehavior,
      ].join("\n");

      return {
        understanding: {
          observedBehavior: parsedJson.observedBehavior,
          context: parsedJson.context,
          intent: parsedJson.intent,
          isAmbiguous: parsedJson.isAmbiguous,
        },
        draft: {
          title: parsedJson.title.slice(0, 200),
          description: description.slice(0, 5000),
          suggestedType: parsedJson.suggestedType || normalizeSuggestedType(input.suggestedType) || "Bug",
        },
      };
    }

    return generateFallbackAnalysis(input);
  } catch (error) {
    logger.warn("[visual-interpretation] Claude extraction failed, using fallback generator.", error);
    return generateFallbackAnalysis(input);
  }
}
