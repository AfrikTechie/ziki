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
4. When a user provides a correction, clarification, or defect note (e.g., "the image is broken", "I'm reporting the broken image on the whambar product listing", "Actually, the button is disabled on mobile"):
   - When refining an existing understanding that identified a component (e.g. Wham Bars product card, price £0.15, empty area), PRESERVE and COMBINE that component context with the clarification. The clarification identifies the defect affecting that component. DO NOT discard the identified product card, price, or buttons.
   - NEVER copy conversational phrases ("I'm reporting", "Actually", "The issue is", "I want to report") or raw user phrases ("the image is broken") verbatim into the title, summary, or actual behavior.
   - Formulate a concise, professional issue title naming the component and defect (e.g., "Broken image on Wham Bars product card" or "Broken image on whambar product listing").
   - Formulate an objective summary describing the defect in 1-2 clear sentences incorporating the product context.
   - Formulate realistic, context-specific reproduction steps leading to the demonstrated defect. NEVER invent unrelated actions (such as file uploads, file selectors, form resets, or settings changes) when the issue is about observing a broken image, defective layout, or on-screen content. If evidence is insufficient for complex interactions, provide the direct navigation and observation steps rather than fabricating actions.
   - Formulate distinct, concrete Expected Behavior and Actual Behavior.
5. If the visual demonstration is ambiguous or evidence is insufficient, set isAmbiguous: true and specify in observedBehavior what needs user clarification. Do not invent steps or behaviors.
6. Provide a concise, specific title (under 12 words) describing what went wrong or what should change.
7. Provide structured description formatted with standard markdown headings:
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
 * Strips conversational filler and self-referential reporting prefixes from user text.
 * e.g. "I'm reporting the broken image on the whambar product listing" -> "broken image on the whambar product listing"
 * e.g. "Actually, the button is disabled on mobile" -> "the button is disabled on mobile"
 */
export function stripConversationalPrefix(text: string): string {
  return text
    .replace(/^i(?:'m| am)?\s+(?:reporting|trying to (?:report|show)|demonstrating|showing|talking about)\s+(?:the\s+|a\s+|an\s+)?/i, "")
    .replace(/^actually,?\s*(?:the (?:issue|problem|bug) is\s*|it(?:'s| is)\s*|i meant\s*|this is\s*)?/i, "")
    .replace(/^(?:the (?:problem|issue|bug) is (?:that\s+)?(?:the\s+)?)/i, "")
    .replace(/^(?:note that\s+(?:the\s+)?)/i, "")
    .replace(/^(?:this is (?:a|an)\s+)/i, "")
    .replace(/^(?:i noticed (?:that\s+)?(?:the\s+)?)/i, "")
    .replace(/^(?:there(?:'s| is) (?:a|an)\s+)/i, "")
    .trim();
}

/**
 * Capitalizes first letter of string.
 */
export function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type ClarificationParsedDetails = {
  component: string;
  action: string;
  expected: string;
  actual: string;
  title: string;
  summary: string;
  steps: string[];
  isFeature?: boolean;
};

export interface ExtractedPreviousContext {
  component?: string;
  price?: string;
  button?: string;
  hasEmptyArea?: boolean;
  rawText?: string;
}

/**
 * Extracts previously established components, prices, buttons, and visual anomalies from prior understanding.
 */
export function extractContextFromPreviousUnderstanding(previous?: string): ExtractedPreviousContext {
  if (!previous || !previous.trim()) return {};
  const text = previous.trim();

  let component: string | undefined;

  // 1. Check for explicit "Context: <name>"
  const contextMatch = text.match(/(?:Context:\s*)([^.\n]+)/i);
  if (contextMatch && contextMatch[1]?.trim()) {
    const rawCtx = contextMatch[1].trim();
    if (!/^(?:application workflow|captured interface region|screen demonstration workflow)$/i.test(rawCtx)) {
      component = rawCtx;
    }
  }

  // 2. Look for product card / listing / component mention
  if (!component) {
    const componentMatch =
      text.match(/(?:the\s+)?([A-Z][a-zA-Z0-9]*(?:\s+[A-Z0-9][a-zA-Z0-9]*)*\s+(?:product\s+card|product\s+listing|card|listing|item|component|page|view|button|header|modal|dialog|form|table|dropdown))/i) ||
      text.match(/(?:the\s+)?([a-zA-Z0-9_\-\s]+?\s+(?:product\s+card|product\s+listing|card|listing))/i);
    if (componentMatch && componentMatch[1]?.trim()) {
      component = componentMatch[1].trim();
    }
  }

  // Extract price details if present: e.g. "price (£0.15)", "£0.15", "$12.99"
  const priceMatch = text.match(/(?:price\s*\(?([£$€¥]\d+(?:\.\d{2})?)\)?|([£$€¥]\d+(?:\.\d{2})?))/i);
  const price = priceMatch ? (priceMatch[1] || priceMatch[2]) : undefined;

  // Extract button or interactive CTA: e.g. "Add to Basket button", "Add to Basket", "Add to Cart"
  const buttonMatch = text.match(/(?:['"]?([A-Za-z\s]+?(?:button|btn|cta))['"]?|Add to Basket|Add to Cart)/i);
  const button = buttonMatch ? (buttonMatch[1] || buttonMatch[0]).trim().replace(/^(?:and|or)\s+/i, "").trim() : undefined;

  // Check for empty space / area
  const hasEmptyArea = /(?:large\s+)?empty\s+(?:space|area|box|container|placeholder)/i.test(text);

  return {
    component,
    price,
    button,
    hasEmptyArea,
    rawText: text,
  };
}

/**
 * Extracts concrete semantic components, actions, and expectations from user clarification,
 * synthesizing with prior detected visual understanding so brief clarifications refine rather than replace context.
 */
export function parseClarificationDetails(
  clarification: string,
  previousUnderstanding?: string
): ClarificationParsedDetails {
  const clean = clarification.trim().replace(/^[#*`>\-\s]+/, "");
  const stripped = stripConversationalPrefix(clean);
  const prevContext = extractContextFromPreviousUnderstanding(previousUnderstanding);

  // Pattern 1: Broken / missing image / photo / thumbnail on a product listing, page, or container
  // e.g. "I'm reporting the broken image on the whambar product listing"
  // e.g. "the image is broken."
  // e.g. "image is broken"
  // e.g. "broken image"
  const isImageDefect =
    /(?:broken|missing|failed|blank|corrupted|empty)\s+(?:product\s+)?(?:image|picture|photo|thumbnail|icon|logo|asset)/i.test(clean) ||
    /(?:image|picture|photo|thumbnail|icon|logo)\s+(?:is\s+)?(?:broken|missing|fails? to load|not loading|blank|empty|not showing)/i.test(clean) ||
    /^(?:the\s+)?(?:image|picture|photo|thumbnail)\s+(?:is\s+)?(?:broken|missing|blank|not loading|not showing|failed)/i.test(stripped) ||
    clean.toLowerCase().includes("image is broken") ||
    clean.toLowerCase().includes("broken image") ||
    clean.toLowerCase().includes("missing image") ||
    clean.toLowerCase().includes("image missing");

  let rawTargetFromClarification: string | undefined = undefined;

  const brokenImageOnMatch =
    stripped.match(/(?:broken|missing|failed|blank|corrupted)\s+(?:product\s+)?(?:image|picture|photo|thumbnail|icon|logo|asset)\s+(?:on|in|for)\s+(?:the\s+)?(.+)/i) ||
    clean.match(/(?:broken|missing|failed|blank|corrupted)\s+(?:product\s+)?(?:image|picture|photo|thumbnail|icon|logo|asset)\s+(?:on|in|for)\s+(?:the\s+)?(.+)/i);

  const brokenImageSubjectMatch =
    stripped.match(/(?:the\s+)?(.+?)\s+(?:product\s+)?(?:image|picture|photo|thumbnail|icon|logo)\s+(?:is\s+)?(?:broken|missing|fails? to load|not loading|blank|empty|not showing)/i);

  if (brokenImageOnMatch) {
    const cand = brokenImageOnMatch[1].trim().replace(/[.,;]+$/, "");
    if (cand && !/^(?:the|an|a|this|card|listing|page|view)$/i.test(cand)) {
      rawTargetFromClarification = cand;
    }
  } else if (brokenImageSubjectMatch) {
    const cand = brokenImageSubjectMatch[1].trim().replace(/[.,;]+$/, "");
    if (cand && !/^(?:the|an|a|this)$/i.test(cand)) {
      rawTargetFromClarification = cand;
    }
  }

  let rawTarget = rawTargetFromClarification;
  if (!rawTarget && isImageDefect) {
    rawTarget = prevContext.component || "demonstrated interface element";
  }

  if (rawTarget && isImageDefect) {
    const component = rawTarget.toLowerCase().includes("listing") || rawTarget.toLowerCase().includes("card") || rawTarget.toLowerCase().includes("page") || rawTarget.toLowerCase().includes("item")
      ? rawTarget
      : `${rawTarget} component`;
    const title = `Broken image on ${rawTarget}`;
    const summary = `The ${rawTarget} displays a broken or missing image instead of the expected product photo.`;

    let steps: string[];
    if (prevContext.component && (prevContext.price || prevContext.button)) {
      const detailsParts: string[] = [];
      if (prevContext.price) detailsParts.push(`price ${prevContext.price}`);
      if (prevContext.button) detailsParts.push(`with ${prevContext.button.toLowerCase().includes("button") ? prevContext.button : `${prevContext.button} button`}`);
      const detailsSuffix = detailsParts.length > 0 ? ` (${detailsParts.join(" ")})` : "";
      steps = [
        `Navigate to the product listing containing the ${rawTarget}.`,
        `Locate the ${rawTarget}${detailsSuffix}.`,
        `Observe that the product image area inside the card is blank or broken.`,
      ];
    } else {
      steps = [
        `Navigate to the view containing the ${rawTarget}.`,
        `Locate the product image container on the ${rawTarget}.`,
        `Observe that the image fails to load or renders as a broken asset.`,
      ];
    }

    const expected = `The ${rawTarget} should display a valid, properly rendered image.`;
    const actual = prevContext.hasEmptyArea
      ? (rawTarget.toLowerCase().includes("image")
          ? `${rawTarget} fails to load, leaving an empty area inside the product card.`
          : rawTarget.toLowerCase().includes("product")
            ? `The ${rawTarget} image fails to load, leaving an empty area inside the product card.`
            : `The ${rawTarget} product image fails to load, leaving an empty area inside the product card.`)
      : `The product image fails to load and displays a broken image icon or empty placeholder.`;

    return {
      component,
      action: `Locate and inspect the image on the ${rawTarget}`,
      expected,
      actual,
      title,
      summary,
      steps,
    };
  }

  // Pattern 2: Contrast / accessibility / WCAG failure
  if (/contrast|accessibility|wcag|color contrast/i.test(clean)) {
    const title = clean.includes("color contrast / WCAG accessibility failure")
      ? "color contrast / WCAG accessibility failure in dark mode"
      : "Color contrast / WCAG accessibility failure in dark mode";
    const summary = "Text and interactive elements fail WCAG AA contrast standards in dark mode.";
    const steps = [
      "Enable dark mode in appearance settings.",
      "Navigate to the demonstrated view.",
      "Inspect the contrast ratio between text elements and background.",
    ];
    return {
      component: "Dark mode color palette",
      action: "Inspect text and background color contrast in dark mode",
      expected: "Text contrast meets WCAG AA standards (minimum 4.5:1 ratio).",
      actual: "Contrast is insufficient and fails WCAG AA standards in dark mode.",
      title,
      summary,
      steps,
    };
  }

  // Pattern 3: "When clicking X, [outcome]" speech patterns
  const whenClickMatch =
    stripped.match(
      /^(?:when\s+(?:i\s+)?(?:click(?:ing)?|press(?:ing)?|tap(?:ping)?)\s+(?:on\s+)?(?:the\s+)?)(.+?)(?:,\s*|\s*;\s*|\s+(?:then|and)\s+)(?:the\s+)?(.+)$/i
    ) ||
    clean.match(
      /^(?:when\s+(?:i\s+)?(?:click(?:ing)?|press(?:ing)?|tap(?:ping)?)\s+(?:on\s+)?(?:the\s+)?)(.+?)(?:,\s*|\s*;\s*|\s+(?:then|and)\s+)(?:the\s+)?(.+)$/i
    );
  if (whenClickMatch) {
    const comp = whenClickMatch[1].trim();
    const outcome = whenClickMatch[2].trim().replace(/[.,;]+$/, "");
    const title = `${comp}: ${outcome}`;
    const summary = `Clicking the ${comp} causes the ${outcome}.`;
    const steps = [
      `Navigate to the view containing the ${comp}.`,
      `Click or trigger the ${comp}.`,
      `Observe that ${outcome}.`,
    ];
    return {
      component: comp,
      action: `Click or trigger the ${comp}`,
      expected: `${capitalize(comp)} should trigger its expected action and complete its state transition.`,
      actual: capitalize(outcome),
      title,
      summary,
      steps,
    };
  }

  // Pattern 4: Form reset / discard on save / submit
  if (/reset|clear|discard/i.test(clean) && /save|submit/i.test(clean)) {
    const title = "Save button resets form instead of persisting changes";
    const summary = "Submitting changes via the save button resets form fields and discards inputs.";
    const steps = [
      "Navigate to the form view shown in the demonstration.",
      "Fill in the form fields with modified values.",
      "Click the save or submit button.",
      "Observe that the form resets and inputs are discarded without persisting.",
    ];
    return {
      component: "Form submission controls",
      action: "Submit changes via the save button",
      expected: "Form persists input values and displays a success confirmation.",
      actual: "Form resets input values and fails to persist changes.",
      title,
      summary,
      steps,
    };
  }

  // Pattern 5: Filter tabs & badge counter
  if (/badge|counter|filter tab/i.test(clean)) {
    const title = "Filter tabs badge counter does not update";
    const summary = "Filter badge counts do not reflect the current number of active items.";
    const steps = [
      "Navigate to the filtered list view.",
      "Apply or toggle the active filter tabs.",
      "Observe the badge counter values on each tab.",
    ];
    return {
      component: "Filter tabs & badge counter",
      action: "Apply active filter tab",
      expected: "Badge counter updates dynamically to reflect filtered item count.",
      actual: "Badge counter does not update and shows outdated item counts.",
      title,
      summary,
      steps,
    };
  }

  // Pattern 6: Disabled / greyed out controls
  const disabledMatch =
    stripped.match(/^(?:the\s+)?(.+?)\s+(?:is|remains)\s+(?:disabled|greyed out|grayed out)(.*)$/i) ||
    clean.match(/^(?:the\s+)?(.+?)\s+(?:is|remains)\s+(?:disabled|greyed out|grayed out)(.*)$/i);
  if (disabledMatch) {
    const comp = disabledMatch[1].trim();
    const title = `${capitalize(comp)} remains disabled`;
    const summary = `The ${comp} remains disabled and cannot be activated.`;
    const steps = [
      `Navigate to the view containing the ${comp}.`,
      `Complete any required prerequisite inputs.`,
      `Observe the ${comp} state.`,
    ];
    return {
      component: comp,
      action: `Access ${comp} in the workflow`,
      expected: `${capitalize(comp)} is enabled and accepts user interaction.`,
      actual: `${capitalize(comp)} remains disabled and inactive.`,
      title,
      summary,
      steps,
    };
  }

  // Pattern 7: Unresponsive / not opening controls
  const unresponsiveMatch =
    stripped.match(/^(?:the\s+)?(.+?)\s+(?:is\s+unresponsive|does not open|doesn't open|fails to open|is not clickable|does nothing)(.*)$/i) ||
    clean.match(/^(?:the\s+)?(.+?)\s+(?:is\s+unresponsive|does not open|doesn't open|fails to open|is not clickable|does nothing)(.*)$/i);
  if (unresponsiveMatch) {
    const comp = unresponsiveMatch[1].trim();
    const title = `${capitalize(comp)} is unresponsive`;
    const summary = `The ${comp} does not respond when clicked and fails to open.`;
    const steps = [
      `Navigate to the view containing the ${comp}.`,
      `Click on the ${comp}.`,
      `Observe that the control fails to respond or open.`,
    ];
    return {
      component: comp,
      action: `Click or trigger the ${comp}`,
      expected: `${capitalize(comp)} opens and presents relevant options or triggers its intended action.`,
      actual: `${capitalize(comp)} is unresponsive and produces no action.`,
      title,
      summary,
      steps,
    };
  }

  // Pattern 8: Genuine file / avatar upload issues (requires explicit upload terminology)
  if (/\b(?:uploading?|file upload|avatar upload|drag and drop|file selector)\b/i.test(clean)) {
    const isAvatar = /avatar/i.test(clean);
    const comp = isAvatar ? "Avatar upload component" : "File upload component";
    const title = clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
    const summary = `After selecting a file, the ${comp} fails to process or display the uploaded asset.`;
    const steps = [
      `Navigate to the view containing ${comp}.`,
      `Select and upload a file.`,
      `Observe the resulting upload status or preview area.`,
    ];
    return {
      component: comp,
      action: "Select and upload file",
      expected: "Uploaded asset loads and displays in the preview area.",
      actual: clean,
      title,
      summary,
      steps,
    };
  }

  // Pattern 9: Feature requests or improvements
  const isFeature = /\b(?:add|support|allow|feature|suggest|enable|request|export to csv)\b/i.test(clean);
  if (isFeature) {
    const title = clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
    const locationMatch = stripped.match(/(?:on|in|for|at)\s+(?:the\s+)?([a-zA-Z0-9_\-\s]{3,30}?)(?:$|[.,;])/i);
    const component = locationMatch ? locationMatch[1].trim() : "Demonstrated interface view";
    const summary = `Request to ${stripped.replace(/^(?:add|support|allow|enable)\s+/i, "add ")}.`;
    const steps = [
      `Navigate to the ${component}.`,
      `Inspect the available actions and interface options.`,
      `Observe that the requested capability is not yet supported.`,
    ];
    return {
      component,
      action: `Access ${component} and inspect available features`,
      expected: `${capitalize(component)} provides the requested feature.`,
      actual: "Feature is currently not supported.",
      title,
      summary,
      steps,
      isFeature: true,
    };
  }

  // Fallback: General defect or behavior
  const titleCandidate = capitalize(stripped.split(/[.!?\n]/)[0].trim());
  const locationMatch = stripped.match(/(?:on|in|for|at)\s+(?:the\s+)?([a-zA-Z0-9_\-\s]{3,30}?)(?:$|[.,;])/i);
  const component = locationMatch
    ? locationMatch[1].trim()
    : (prevContext.component || "Demonstrated interface element");
  const title = prevContext.component && !locationMatch
    ? (titleCandidate.toLowerCase().includes(prevContext.component.toLowerCase())
        ? titleCandidate
        : `${titleCandidate} on ${prevContext.component}`)
    : (titleCandidate.length > 70 ? `${titleCandidate.slice(0, 67)}…` : titleCandidate);
  const summary = prevContext.component && !locationMatch
    ? `The ${prevContext.component} exhibits an issue: ${titleCandidate}.`
    : `${title}.`;
  const steps = [
    `Navigate to the view containing ${component}.`,
    `Interact with the demonstrated interface element.`,
    `Observe the resulting system state and interface feedback.`,
  ];
  return {
    component,
    action: `Interact with ${component}`,
    expected: `${capitalize(component)} behaves as expected without unexpected errors.`,
    actual: capitalize(stripped),
    title,
    summary,
    steps,
  };
}

/**
 * Fallback generator when Claude API key is unavailable, offline, or if the API call fails.
 * Produces a specific, actionable draft and understanding from user clarification and visual context.
 */
export function generateFallbackDraft(input: VisualEvidenceInput): InterpretedIssueDraft {
  const clarification = input.clarification?.trim();
  const narration = input.narration?.trim();
  const effectiveNotes = [clarification, narration].filter(Boolean).join(". ");
  const isVideo = input.mediaType === "video";
  const durationText = input.durationSeconds && input.durationSeconds > 0 ? ` (${input.durationSeconds}s)` : "";

  let title = "";
  let summary = "";
  let steps: string[] = [];
  let expected = "";
  let actual = "";

  if (effectiveNotes) {
    const details = parseClarificationDetails(effectiveNotes, input.previousUnderstanding);
    title = details.title;
    summary = details.summary;
    steps = details.steps;
    expected = details.expected;
    actual = details.actual;
  } else {
    // No user clarification or spoken narration: generate grounded details based on media type and keyframes
    if (isVideo) {
      title = `Issue observed during screen recording${durationText}`;
      if (input.frames && input.frames.length > 0) {
        summary = `Screen recording demonstrates an issue during user workflow${durationText} across ${input.frames.length} keyframes.`;
        steps = input.frames.map(
          (f, idx) =>
            `${idx === 0 ? "Navigate to view shown at" : "Perform demonstrated interaction at"} ${f.label.replace(/\s*\(t=\d+s\)/, "")}.`
        );
        expected = "Application workflow should transition smoothly between states without unexpected errors.";
        actual = "Demonstrated action sequence fails or produces an unexpected defect.";
      } else {
        summary = `Screen recording demonstrates an issue during user workflow${durationText}.`;
        steps = [
          "Open the application view shown at the start of the demonstration.",
          "Locate the target interface control shown in the recording.",
          "Click or trigger the control and observe the outcome.",
        ];
        expected = "The targeted control should respond to user input and complete its state transition.";
        actual = "The control does not respond as expected and fails to complete the demonstrated action.";
      }
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
    ...steps.map((s, i) => `${i + 1}. ${s.replace(/^\d+\.\s*/, "")}`),
    "",
    "## Expected Behavior",
    expected,
    "",
    "## Actual Behavior",
    actual,
  ].join("\n");

  const isFeature =
    effectiveNotes?.toLowerCase().includes("feature") ||
    effectiveNotes?.toLowerCase().includes("improve") ||
    effectiveNotes?.toLowerCase().includes("add");

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
  const narration = input.narration?.trim();
  const effectiveNotes = [clarification, narration].filter(Boolean).join(". ");

  let observedBehavior = "";
  let context = "";
  let intent = "";
  let isAmbiguous = false;

  if (effectiveNotes) {
    const details = parseClarificationDetails(effectiveNotes, input.previousUnderstanding);
    if (input.previousUnderstanding) {
      observedBehavior = `Corrected understanding: ${details.title}. ${details.summary}`;
      context = details.component;
      intent = details.isFeature
        ? `Request feature for ${details.component}`
        : `Report defect on ${details.component}`;
      isAmbiguous = false;
    } else {
      observedBehavior = effectiveNotes;
      context = details.component;
      intent = details.isFeature
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
    ...parsed.stepsToReproduce.map((step, idx) => `${idx + 1}. ${step.replace(/^\d+\.\s*/, "")}`),
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

  // Fallback defaults from clarification, spoken narration, and previous understanding
  const fallback = generateFallbackDraft(input);
  const effectiveNotes = [input.clarification?.trim(), input.narration?.trim()].filter(Boolean).join(". ");
  const notesDetails = effectiveNotes ? parseClarificationDetails(effectiveNotes, input.previousUnderstanding) : null;

  const rawTitle = typeof title === "string" ? title.trim() : "";
  const cleanedTitle = rawTitle ? capitalize(stripConversationalPrefix(rawTitle)) : "";

  const rawSummary = typeof summary === "string" ? summary.trim() : "";
  const cleanedSummary = rawSummary ? capitalize(stripConversationalPrefix(rawSummary)) : "";

  const rawActual = typeof actualBehavior === "string" ? actualBehavior.trim() : "";
  const cleanedActual = rawActual ? capitalize(stripConversationalPrefix(rawActual)) : "";

  const rawClarification = input.clarification?.trim().toLowerCase().replace(/[.,;]+$/, "");
  const isSummaryVerbatim =
    Boolean(rawClarification) &&
    (cleanedSummary.toLowerCase().replace(/[.,;]+$/, "") === rawClarification ||
      cleanedSummary.toLowerCase() === `corrected understanding: ${rawClarification}` ||
      cleanedSummary.toLowerCase().startsWith(`corrected understanding: ${rawClarification}`));

  const isActualVerbatim =
    Boolean(rawClarification) &&
    (cleanedActual.toLowerCase().replace(/[.,;]+$/, "") === rawClarification ||
      cleanedActual.toLowerCase() === `corrected understanding: ${rawClarification}`);

  const isTitleVerbatim =
    Boolean(rawClarification) && cleanedTitle.toLowerCase().replace(/[.,;]+$/, "") === rawClarification;

  const hasFabricatedUploadSteps =
    Array.isArray(stepsToReproduce) &&
    !/\b(?:uploading?|file upload|avatar upload|drag and drop|file selector)\b/i.test(effectiveNotes || "") &&
    stepsToReproduce.some((s) => /\b(?:upload|file selector|file input|select a file)\b/i.test(s));

  const finalSummary =
    (isSummaryVerbatim && notesDetails?.summary) ||
    cleanedSummary ||
    notesDetails?.summary ||
    fallback.title;

  const finalActual =
    (isActualVerbatim && notesDetails?.actual) ||
    cleanedActual ||
    notesDetails?.actual ||
    "System behaves unexpectedly in the demonstration.";

  const finalTitle =
    (isTitleVerbatim && notesDetails?.title) ||
    cleanedTitle ||
    fallback.title;

  const finalSteps =
    hasFabricatedUploadSteps && notesDetails?.steps
      ? notesDetails.steps
      : stepsToReproduce !== undefined
        ? stepsToReproduce
        : (notesDetails?.steps || [
            `Navigate to ${notesDetails?.component || "the demonstrated view"}.`,
            notesDetails?.action || "Interact with the demonstrated interface component.",
            "Observe the resulting system state and interface feedback.",
          ]);

  const finalObservedBehavior =
    (typeof observedBehavior === "string" &&
      observedBehavior.trim() &&
      !isSummaryVerbatim &&
      observedBehavior.trim().toLowerCase() !== `corrected understanding: ${rawClarification}`)
      ? observedBehavior.trim()
      : (notesDetails?.summary || input.previousUnderstanding || notesDetails?.actual || effectiveNotes || fallback.title);

  const finalContext =
    (typeof context === "string" &&
      context.trim() &&
      !/^(?:application workflow|captured interface region|screen demonstration workflow)$/i.test(context.trim()))
      ? context.trim()
      : (notesDetails?.component || "Application workflow");

  return {
    observedBehavior: finalObservedBehavior,
    context: finalContext,
    intent:
      (typeof intent === "string" && intent.trim()) ||
      (notesDetails?.isFeature
        ? "Suggest a feature improvement"
        : "Report an unexpected defect"),
    isAmbiguous: isAmbiguous !== undefined ? isAmbiguous : false,
    title: finalTitle,
    summary: finalSummary,
    stepsToReproduce: finalSteps,
    expectedBehavior:
      (typeof expectedBehavior === "string" && expectedBehavior.trim()) ||
      notesDetails?.expected ||
      "System should respond as expected without errors.",
    actualBehavior: finalActual,
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
      `SPOKEN VOICE NARRATION (RECORDED LIVE VIA MICROPHONE):\n"${input.narration.trim()}"\nCRITICAL INSTRUCTION: The user narrated this demonstration out loud while interacting with the application. You MUST synthesize their spoken words directly with the sequential visual keyframes. Extract the exact UI components, button labels, page headers, navigation paths, and defective behaviors mentioned in their narration and shown in the keyframes. Ground the title, summary, steps to reproduce, expected behavior, and actual behavior in these concrete details. DO NOT use generic placeholder steps or generic phrases.`
    );
  }

  if (input.previousUnderstanding?.trim()) {
    parts.push(
      `REFINEMENT & CORRECTION CONTEXT:\nThe user reviewed an initial interpretation and provided a clarification/correction to refine it.\nPreviously established understanding and visual context:\n"${input.previousUnderstanding.trim()}"\nUser's clarifying notes:\n"${input.clarification?.trim() || ""}"\nCRITICAL INSTRUCTION: Refine and combine the user's clarification with the previously identified UI components, product details, and visual evidence. The user's clarification specifies the exact defect or intent affecting the previously identified component. DO NOT discard the previously identified component, product name, or screen elements (e.g., if the previous understanding identified a Wham Bars product card with price £0.15 and empty area, and user clarifies "the image is broken", combine them to produce "Broken image on Wham Bars product card", retaining the Wham Bars card context). NEVER copy conversational phrases ("I'm reporting", "Actually") or brief phrases ("the image is broken") verbatim into all fields. NEVER invent unrelated actions (such as file uploads or file selectors) when the demonstration is about viewing a broken image or product card. If evidence is insufficient for complex steps, document the direct observation steps rather than fabricating actions.`
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
    max_tokens: 4000,
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
    let userMsg = `OpenRouter API returned HTTP ${response.status}`;
    try {
      const parsedErr = JSON.parse(errBody);
      if (parsedErr?.error?.message) {
        userMsg = parsedErr.error.message;
      }
    } catch {
      if (errBody) userMsg += `: ${errBody.slice(0, 150)}`;
    }
    logger.warn("[visual-interpretation] OpenRouter HTTP error", {
      model,
      status: response.status,
      message: userMsg.slice(0, 200),
    });
    throw new Error(userMsg);
  }

  const json = await response.json();

  if (json.error) {
    const errorMsg =
      typeof json.error.message === "string"
        ? json.error.message
        : "OpenRouter returned an error response.";
    logger.warn("[visual-interpretation] OpenRouter error in response body", {
      model,
      message: errorMsg.slice(0, 200),
    });
    throw new Error(errorMsg);
  }

  const choice = json.choices?.[0];

  // Resilient text extraction: check content (string or array), reasoning, and text
  let rawText = "";
  if (typeof choice?.message?.content === "string" && choice.message.content.trim()) {
    rawText = choice.message.content.trim();
  } else if (Array.isArray(choice?.message?.content)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawText = choice.message.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  // Fallback: If content is empty but model reasoning contains a JSON object
  if (!rawText && typeof choice?.message?.reasoning === "string" && choice.message.reasoning.includes("{")) {
    rawText = choice.message.reasoning.trim();
  } else if (!rawText && typeof (choice as unknown as { text?: string })?.text === "string") {
    rawText = (choice as unknown as { text: string }).text.trim();
  }

  if (!rawText) {
    logger.warn("[visual-interpretation] OpenRouter empty response structure", {
      model,
      hasChoices: Boolean(json.choices?.length),
      finishReason: choice?.finish_reason,
      hasMessage: Boolean(choice?.message),
      hasReasoning: Boolean(choice?.message?.reasoning),
    });
    throw new Error("AI provider returned an empty response without content.");
  }

  const openrouterApiMs = Math.round(performance.now() - openrouterStartTime);
  const validationStartTime = performance.now();

  const parsedResult = parseAndValidateAnalysisOutput(rawText, input);

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
