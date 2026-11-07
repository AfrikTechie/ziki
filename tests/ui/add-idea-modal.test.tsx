// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddIdeaModal } from "@/components/add-idea-modal";
import { createBugAction } from "@/app/actions/issues";
import { interpretVisualEvidenceAction } from "@/app/actions/visual-interpretation";
import { type VisualAnalysisResult } from "@/lib/visual-interpretation";
import { unstable_rethrow } from "next/navigation";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/app/actions/issues", () => ({
  createBugAction: vi.fn(),
}));

vi.mock("@/app/actions/visual-interpretation", () => ({
  interpretVisualEvidenceAction: vi.fn(),
}));

const mockedCreateBug = vi.mocked(createBugAction);
const mockedInterpretVisual = vi.mocked(interpretVisualEvidenceAction);
const mockedRethrow = vi.mocked(unstable_rethrow);

describe("AddIdeaModal (Visual Capture, AI Interpretation & User Confirmation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateBug.mockResolvedValue({} as never);
    mockedInterpretVisual.mockResolvedValue({
      success: true,
      understanding: {
        observedBehavior: "Clicking save button resets form without persisting changes",
        context: "Settings form",
        intent: "Report form submission defect",
        isAmbiguous: false,
      },
      draft: {
        title: "Generated Bug Title from AI",
        description: "## Summary\nAI generated bug summary.\n\n## Steps to Reproduce\n1. Do something.\n\n## Expected Behavior\nWork.\n\n## Actual Behavior\nFailed.",
        suggestedType: "Bug",
      },
    });

    // Mock HTMLDialogElement methods in jsdom
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    // Mock ObjectURL methods
    globalThis.URL.createObjectURL = vi.fn(() => "blob:http://localhost/mock-blob");
    globalThis.URL.revokeObjectURL = vi.fn();

    // Mock HTMLCanvasElement for screenshot frame captures in jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as never;
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["raw-frame-image"], { type: "image/png" }));
    });

    // Mock HTMLVideoElement for screen capture frames in jsdom
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLVideoElement.prototype, "srcObject", {
      set(val) {
        this._srcObject = val;
        setTimeout(() => {
          Object.defineProperty(this, "videoWidth", { value: 1920, configurable: true });
          Object.defineProperty(this, "videoHeight", { value: 1080, configurable: true });
          if (this.onloadedmetadata) {
            this.onloadedmetadata(new Event("loadedmetadata"));
          }
        }, 10);
      },
      get() {
        return this._srcObject;
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the three submission options on open", () => {
    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    expect(screen.getByText("Add idea")).toBeTruthy();
    expect(screen.getByText("How would you like to describe it?")).toBeTruthy();
    expect(screen.getByText("Record screen")).toBeTruthy();
    expect(screen.getByText("Capture area")).toBeTruthy();
    expect(screen.getByText("Write description")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("navigates directly to review draft when 'Write description' is selected", async () => {
    const user = userEvent.setup();
    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    // Select Write description
    const writeBtn = screen.getByText("Write description").closest("button");
    expect(writeBtn).not.toBeNull();
    await user.click(writeBtn!);

    // Click Continue
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Should now be directly on review draft
    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit idea" })).toBeTruthy();
  });

  it("supports switching to the inline composer when requested", async () => {
    const user = userEvent.setup();
    const onOpenInlineComposer = vi.fn();

    render(
      <AddIdeaModal
        isOpen={true}
        onClose={vi.fn()}
        projectId="p1"
        onOpenInlineComposer={onOpenInlineComposer}
      />
    );

    const switchBtn = screen.getByRole("button", { name: /Prefer inline composer/i });
    expect(switchBtn).toBeTruthy();
    await user.click(switchBtn);

    expect(onOpenInlineComposer).toHaveBeenCalledTimes(1);
  });

  it("validates title and description before submission", async () => {
    const user = userEvent.setup();
    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    // Go to write description
    await user.click(screen.getByText("Write description").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Try submitting empty
    await user.click(screen.getByRole("button", { name: "Submit idea" }));

    expect(mockedCreateBug).not.toHaveBeenCalled();
    expect(screen.getByText("Title must be at least 3 characters")).toBeTruthy();
    expect(screen.getByText("Description must be at least 10 characters")).toBeTruthy();

    // Fill valid data
    await user.type(screen.getByLabelText("Title"), "Valid Issue Title");
    await user.type(screen.getByLabelText("Description"), "This is a detailed description of the issue.");

    await user.click(screen.getByRole("button", { name: "Submit idea" }));

    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
    });
  });

  it("handles redirect re-throwing properly via unstable_rethrow", async () => {
    const user = userEvent.setup();
    const redirectErr = new Error("NEXT_REDIRECT");
    mockedCreateBug.mockRejectedValue(redirectErr);

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByText("Write description").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await user.type(screen.getByLabelText("Title"), "Valid Issue Title");
    await user.type(screen.getByLabelText("Description"), "Valid Issue Description over 10 chars");

    await user.click(screen.getByRole("button", { name: "Submit idea" }));

    await waitFor(() => {
      expect(mockedRethrow).toHaveBeenCalledWith(redirectErr);
    });
  });

  it("supports recording lifecycle, evidence review, AI understanding, and user confirmation", async () => {
    const user = userEvent.setup();

    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    let onDataAvailableHandler: ((e: { data: Blob }) => void) | null = null;

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
        onDataAvailableHandler = this.ondataavailable;
      }
      stop() {
        this.state = "inactive";
        if (onDataAvailableHandler) {
          onDataAvailableHandler({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    // Proceed with Record screen
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));

    // Now recording
    expect(screen.getByText("Recording in progress")).toBeTruthy();

    // Stop recording
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    // Should show local playback video and Record again button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    // Advance to Step 2: Details & Evidence Review
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Review evidence & AI interpretation")).toBeTruthy();
    expect(screen.getByText("Screen recording captured")).toBeTruthy();

    // Expect AI interpretation to automatically run and display understanding
    await waitFor(() => {
      expect(mockedInterpretVisual).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText("Ziki's understanding")).toBeTruthy();
    expect(
      screen.getByText("Clicking save button resets form without persisting changes")
    ).toBeTruthy();

    // Explicit confirmation button is displayed
    const confirmBtn = screen.getByRole("button", { name: /Confirm & continue to draft/i });
    expect(confirmBtn).toBeTruthy();

    // User confirms understanding
    await user.click(confirmBtn);

    // Moves to Step 3: Review issue draft with AI fields populated
    await waitFor(() => {
      expect(screen.getByText("Review issue draft")).toBeTruthy();
    });

    expect(screen.getByText(/We've created a draft based on your recording/i)).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Generated Bug Title from AI");
    expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toContain("## Summary");

    // Editable draft before submission
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Modified Bug Title by User");

    // Click Edit details to go back to Step 2
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByText("Review evidence & AI interpretation")).toBeTruthy();

    // Confirm again to return to review draft
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));
    expect(screen.getByText("Review issue draft")).toBeTruthy();

    // Submit idea
    await user.click(screen.getByRole("button", { name: "Submit idea" }));
    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
    });
  });

  it("allows user to correct misunderstanding when AI intent is ambiguous", async () => {
    const user = userEvent.setup();

    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Initial interpretation has ambiguous intent
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "User interacted with multiple filter tabs on the page",
        context: "Filter tabs header",
        intent: "Unclear whether filtering failed or display count was incorrect",
        isAmbiguous: true,
      },
      draft: {
        title: "Filter tab interaction issue",
        description: "## Summary\nFilter issue.",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Verifies ambiguous intent warning is rendered
    await waitFor(() => {
      expect(screen.getByText("Ambiguous Intent Detected")).toBeTruthy();
    });

    // Open clarification / correction
    await user.click(screen.getByRole("button", { name: /\+ Clarify or correct/i }));

    const correctionInput = screen.getByPlaceholderText(/Actually, the bug only happens/i);
    await user.type(
      correctionInput,
      "Actually, the filter works, but the badge counter does not decrement"
    );

    // Mock corrected re-interpretation
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "Badge counter fails to decrement when filters are applied",
        context: "Filter badge counter",
        intent: "Fix filter badge count synchronization",
        isAmbiguous: false,
      },
      draft: {
        title: "Filter badge counter does not decrement when filters applied",
        description: "## Summary\nBadge counter sync issue.\n\n## Steps to Reproduce\n1. Apply filter.",
        suggestedType: "Bug",
      },
    });

    // Update with correction
    await user.click(screen.getByRole("button", { name: /Update with correction/i }));

    await waitFor(() => {
      expect(mockedInterpretVisual).toHaveBeenCalledTimes(2);
    });

    // Understanding card updates to reflect user's correction
    await waitFor(() => {
      expect(
        screen.getByText("Badge counter fails to decrement when filters are applied")
      ).toBeTruthy();
    });

    // User confirms updated understanding
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));

    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Filter badge counter does not decrement when filters applied"
    );
  });

  it("supports correcting AI interpretation for broken product image listing and generates specific issue draft without generic upload steps", async () => {
    const user = userEvent.setup();
    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["recorded video chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Initial interpretation missed the broken image
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "User scrolled on the products page",
        context: "Products page",
        intent: "Browse products",
        isAmbiguous: true,
      },
      draft: {
        title: "Product browsing issue",
        description: "## Summary\nUser scrolled on products page.",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("User scrolled on the products page")).toBeTruthy();
    });

    // Open clarification and enter correction
    await user.click(screen.getByRole("button", { name: /\+ Clarify or correct/i }));
    const correctionInput = screen.getByPlaceholderText(/Actually, the bug only happens/i);
    await user.type(
      correctionInput,
      "I'm reporting the broken image on the whambar product listing"
    );

    // Mock AI refinement incorporating the product listing correction
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "The whambar product listing displays a broken or missing product image",
        context: "whambar product listing",
        intent: "Report broken product image",
        isAmbiguous: false,
      },
      draft: {
        title: "Broken image on whambar product listing",
        description: [
          "## Summary",
          "The whambar product listing displays a broken or missing image instead of the expected product photo.",
          "",
          "## Steps to Reproduce",
          "1. Navigate to the view containing the whambar product listing.",
          "2. Locate the product image container on the whambar product listing.",
          "3. Observe that the image fails to load or renders as a broken asset.",
          "",
          "## Expected Behavior",
          "The whambar product listing should display a valid, properly rendered image.",
          "",
          "## Actual Behavior",
          "The product image fails to load and displays a broken image icon or empty placeholder.",
        ].join("\n"),
        suggestedType: "Bug",
      },
    });

    await user.click(screen.getByRole("button", { name: /Update with correction/i }));

    await waitFor(() => {
      expect(mockedInterpretVisual).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(
        screen.getByText("The whambar product listing displays a broken or missing product image")
      ).toBeTruthy();
    });

    // Confirm understanding and proceed to draft
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));

    expect(screen.getByText("Review issue draft")).toBeTruthy();
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Broken image on whambar product listing");
    expect(titleInput.value).not.toContain("I'm reporting");

    const descInput = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(descInput.value).toContain("whambar product listing");
    expect(descInput.value).not.toContain("file upload");
    expect(descInput.value).not.toContain("Upload");

    // Submit issue
    await user.click(screen.getByRole("button", { name: "Submit idea" }));
    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
    });
    const formData = mockedCreateBug.mock.calls[0][0];
    expect(formData.get("title")).toBe("Broken image on whambar product listing");
    expect(formData.get("description")).toContain("whambar product listing");
  });

  it("combines Wham Bars product card context with brief 'the image is broken.' clarification without fabricating upload steps", async () => {
    const user = userEvent.setup();

    const mockStream = {
      getTracks: () => [
        {
          stop: vi.fn(),
          kind: "video",
          enabled: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      ],
      getVideoTracks: () => [
        {
          stop: vi.fn(),
          kind: "video",
          enabled: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      ],
      getAudioTracks: () => [],
    };

    class MockMediaRecorder {
      state = "recording";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      stream: unknown;

      constructor(stream: unknown) {
        this.stream = stream;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Initial interpretation correctly identifies Wham Bars product card, price, button, empty area, but ambiguous intent
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior:
          "Wham Bars product card with description, price (£0.15), and Add to Basket button has a large empty space",
        context: "Wham Bars product card",
        intent: "Ambiguous intent",
        isAmbiguous: true,
      },
      draft: {
        title: "Wham Bars product card layout",
        description: "## Summary\nWham Bars product card has an empty area.",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Wham Bars product card with description, price (£0.15), and Add to Basket button has a large empty space"
        )
      ).toBeTruthy();
    });

    // Open clarification and enter brief correction
    await user.click(screen.getByRole("button", { name: /\+ Clarify or correct/i }));
    const correctionInput = screen.getByPlaceholderText(/Actually, the bug only happens/i);
    await user.type(correctionInput, "the image is broken.");

    // AI refinement combines Wham Bars context with the clarification
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior:
          "The Wham Bars product card displays a broken or missing image instead of the expected product photo.",
        context: "Wham Bars product card",
        intent: "Report defect on Wham Bars product card",
        isAmbiguous: false,
      },
      draft: {
        title: "Broken image on Wham Bars product card",
        description: [
          "## Summary",
          "The Wham Bars product card displays a broken or missing image instead of the expected product photo.",
          "",
          "## Steps to Reproduce",
          "1. Navigate to the product listing containing the Wham Bars product card.",
          "2. Locate the Wham Bars product card (price £0.15 with Add to Basket button).",
          "3. Observe that the product image area inside the card is blank or broken.",
          "",
          "## Expected Behavior",
          "The Wham Bars product card should display a valid, properly rendered image.",
          "",
          "## Actual Behavior",
          "The Wham Bars product image fails to load, leaving an empty area inside the product card.",
        ].join("\n"),
        suggestedType: "Bug",
      },
    });

    await user.click(screen.getByRole("button", { name: /Update with correction/i }));

    await waitFor(() => {
      expect(mockedInterpretVisual).toHaveBeenCalledTimes(2);
    });

    // Check arguments of the second call: must have passed previousUnderstanding and clarification
    const secondCallArgs = mockedInterpretVisual.mock.calls[1][0];
    expect(secondCallArgs.clarification).toBe("the image is broken.");
    expect(secondCallArgs.previousUnderstanding).toContain("Wham Bars product card");
    expect(secondCallArgs.previousUnderstanding).toContain("£0.15");

    await waitFor(() => {
      expect(
        screen.getByText(
          "The Wham Bars product card displays a broken or missing image instead of the expected product photo."
        )
      ).toBeTruthy();
    });

    // Confirm understanding and proceed to draft
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));

    expect(screen.getByText("Review issue draft")).toBeTruthy();
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Broken image on Wham Bars product card");
    expect(titleInput.value).not.toBe("the image is broken.");

    const descInput = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(descInput.value).toContain("Wham Bars product card");
    expect(descInput.value).toContain("price £0.15 with Add to Basket button");
    expect(descInput.value).not.toContain("file upload");
    expect(descInput.value).not.toContain("upload");
    expect(descInput.value).not.toContain("Upload");

    // Submit issue
    await user.click(screen.getByRole("button", { name: "Submit idea" }));
    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
    });
    const formData = mockedCreateBug.mock.calls[0][0];
    expect(formData.get("title")).toBe("Broken image on Wham Bars product card");
    expect(formData.get("description")).toContain("Wham Bars product card");
  });

  it("automatically refines draft before review when user clicks 'Confirm & continue to draft' with pending clarification", async () => {
    const user = userEvent.setup();

    const mockStream = {
      getTracks: () => [
        {
          stop: vi.fn(),
          kind: "video",
          enabled: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      ],
      getVideoTracks: () => [
        {
          stop: vi.fn(),
          kind: "video",
          enabled: true,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      ],
      getAudioTracks: () => [],
    };

    class MockMediaRecorder {
      state = "recording";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      stream: unknown;

      constructor(stream: unknown) {
        this.stream = stream;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior:
          "Wham Bars product card with description, price (£0.15), and Add to Basket button has a large empty space",
        context: "Wham Bars product card",
        intent: "Ambiguous intent",
        isAmbiguous: true,
      },
      draft: {
        title: "Wham Bars product card layout",
        description: "## Summary\nWham Bars product card has an empty area.",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Wham Bars product card with description, price (£0.15), and Add to Basket button has a large empty space"
        )
      ).toBeTruthy();
    });

    // User opens clarification and types correction
    await user.click(screen.getByRole("button", { name: /\+ Clarify or correct/i }));
    const correctionInput = screen.getByPlaceholderText(/Actually, the bug only happens/i);
    await user.type(correctionInput, "the image is broken.");

    // User directly clicks "Confirm & continue to draft" WITHOUT clicking "Update with correction"
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior:
          "The Wham Bars product card displays a broken or missing image instead of the expected product photo.",
        context: "Wham Bars product card",
        intent: "Report defect on Wham Bars product card",
        isAmbiguous: false,
      },
      draft: {
        title: "Broken image on Wham Bars product card",
        description: "## Summary\nThe Wham Bars product card displays a broken or missing image.",
        suggestedType: "Bug",
      },
    });

    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));

    await waitFor(() => {
      expect(mockedInterpretVisual).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByText("Review issue draft")).toBeTruthy();
    });

    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    expect(titleInput.value).toBe("Broken image on Wham Bars product card");
  });

  it("integrates tenant issue types into the review selector", async () => {
    const user = userEvent.setup();
    const customTypes = [
      { id: "type-bug-1", name: "Bug" },
      { id: "type-feat-2", name: "Feature" },
    ];

    let capturedData: FormData | null = null;
    mockedCreateBug.mockImplementation(async (data: FormData) => {
      capturedData = data;
      return { ok: true } as never;
    });

    render(
      <AddIdeaModal
        isOpen={true}
        onClose={vi.fn()}
        projectId="p1"
        types={customTypes}
      />
    );

    // Go to write description
    await user.click(screen.getByText("Write description").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Select custom type
    const typeSelect = screen.getByLabelText("Type") as HTMLSelectElement;
    expect(typeSelect).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bug" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Feature" })).toBeTruthy();

    await user.selectOptions(typeSelect, "type-feat-2");
    await user.type(screen.getByLabelText("Title"), "New Feature Idea");
    await user.type(screen.getByLabelText("Description"), "Please add an awesome dark mode toggle.");

    await user.click(screen.getByRole("button", { name: "Submit idea" }));

    await waitFor(() => {
      expect(mockedCreateBug).toHaveBeenCalledTimes(1);
    });

    const data = capturedData as FormData | null;
    expect(data?.get("typeId")).toBe("type-feat-2");
    expect(data?.get("title")).toBe("New Feature Idea");
    expect(data?.get("description")).toBe("Please add an awesome dark mode toggle.");
  });

  it("cleans up media and revokes object URLs when closed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<AddIdeaModal isOpen={true} onClose={onClose} projectId="p1" />);

    // Click close button
    const closeBtn = screen.getByLabelText("Close");
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("supports optional voice narration toggle during screen recording", async () => {
    const user = userEvent.setup();

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Voice narration toggle is rendered
    const narrationSwitch = screen.getByRole("switch", { name: /Toggle voice narration/i });
    expect(narrationSwitch).toBeTruthy();
    expect(narrationSwitch.getAttribute("aria-checked")).toBe("false");

    // Enable voice narration
    await user.click(narrationSwitch);
    expect(narrationSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("captures audio and enables voice narration when toggle is activated", async () => {
    const user = userEvent.setup();

    const mockVideoTrack = { stop: vi.fn(), onended: null };
    const mockAudioTrack = { stop: vi.fn(), onended: null, enabled: true };
    const mockScreenStream = {
      getTracks: vi.fn(() => [mockVideoTrack]),
      getVideoTracks: vi.fn(() => [mockVideoTrack]),
      getAudioTracks: vi.fn(() => []),
    };
    const mockMicStream = {
      getTracks: vi.fn(() => [mockAudioTrack]),
      getAudioTracks: vi.fn(() => [mockAudioTrack]),
    };

    const getUserMediaMock = vi.fn().mockResolvedValue(mockMicStream);
    const getDisplayMediaMock = vi.fn().mockResolvedValue(mockScreenStream);

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: getDisplayMediaMock,
        getUserMedia: getUserMediaMock,
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));

    const narrationSwitch = screen.getByRole("switch", { name: /Toggle voice narration/i });
    await user.click(narrationSwitch);

    await user.click(screen.getByRole("button", { name: /Start recording/i }));

    expect(getUserMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
        video: false,
      })
    );
    expect(mockAudioTrack.enabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Voice narration recorded")).toBeTruthy();
    });
  });

  it("displays transparent AI error notice and allows retry or manual draft when AI analysis fails", async () => {
    const user = userEvent.setup();

    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Mock AI failure
    mockedInterpretVisual.mockResolvedValueOnce({
      success: false,
      error: "Live AI interpretation is unavailable because no Anthropic API key is configured.",
      code: "NO_API_KEY",
      fallbackDraft: {
        title: "Screen recording draft",
        description: "Draft details",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Verifies transparent error notice is rendered instead of fake understanding
    await waitFor(() => {
      expect(screen.getByText("Live AI interpretation unavailable")).toBeTruthy();
    });
    expect(screen.getByText(/no Anthropic API key is configured/i)).toBeTruthy();
    expect(screen.queryByText("Ziki's understanding")).toBeNull();

    // Verify retry button and manual draft button exist
    expect(screen.getByRole("button", { name: /Retry analysis/i })).toBeTruthy();
    const manualBtn = screen.getByRole("button", { name: /Continue to draft manually/i });
    expect(manualBtn).toBeTruthy();

    // User chooses to continue to draft manually
    await user.click(manualBtn);
    expect(screen.getByText("Review issue draft")).toBeTruthy();
  });

  it("allows retrying AI analysis when initial attempt fails without losing recorded demonstration", async () => {
    const user = userEvent.setup();
    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["recorded video chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Mock first failure, then success on retry
    mockedInterpretVisual
      .mockResolvedValueOnce({
        success: false,
        error: "OpenRouter returned an empty response or invalid message structure.",
        code: "PARSE_ERROR",
      })
      .mockResolvedValueOnce({
        success: true,
        understanding: {
          observedBehavior: "Idea details button does not open drawer",
          context: "Ideas page",
          intent: "Open idea details",
          isAmbiguous: false,
        },
        draft: {
          title: "Idea details drawer fails to open on click",
          description: "## Summary\nClicking an idea does not trigger the details panel.",
          suggestedType: "Bug",
        },
      });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Verifies user-friendly error notice is displayed
    await waitFor(() => {
      expect(screen.getByText("Live AI interpretation unavailable")).toBeTruthy();
    });
    expect(
      screen.getByText(/The AI analysis response was incomplete or formatted unexpectedly/i)
    ).toBeTruthy();

    // Click "Retry analysis"
    const retryBtn = screen.getByRole("button", { name: /Retry analysis/i });
    await user.click(retryBtn);

    // Verifies proposed understanding is rendered after successful retry
    await waitFor(() => {
      expect(screen.getByText("Ziki's understanding")).toBeTruthy();
    });
    expect(screen.getByText("Idea details button does not open drawer")).toBeTruthy();
    expect(screen.getByText("Proposed understanding")).toBeTruthy();
  });

  it("displays execution timing breakdown metrics when returned from visual analysis", async () => {
    const user = userEvent.setup();
    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "Settings modal fails to save preferences",
        context: "Settings view",
        intent: "Report save defect",
        isAmbiguous: false,
      },
      draft: {
        title: "Settings modal fails to save preferences",
        description: "## Summary\nSettings not saved.",
        suggestedType: "Bug",
      },
      timings: {
        claudeApiMs: 1850,
        validationMs: 5,
        totalServerMs: 1880,
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Ziki's understanding")).toBeTruthy();
    });

    // Check execution timing metrics display
    expect(screen.getByText(/Claude API: 1\.85s/i)).toBeTruthy();
    expect(screen.getByText(/Validation: 5ms/i)).toBeTruthy();
    expect(screen.getByText(/Server Action:/i)).toBeTruthy();
  });

  it("allows user to skip waiting during analysis and proceed to manual drafting", async () => {
    const user = userEvent.setup();
    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    class MockMediaRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(["video-chunk"], { type: "video/webm" }) });
        }
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      writable: true,
      value: MockMediaRecorder,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    // Slow analysis promise that hasn't resolved yet
    let resolveAnalysis: (val: VisualAnalysisResult) => void = () => {};
    mockedInterpretVisual.mockImplementationOnce(
      () =>
        new Promise<VisualAnalysisResult>((resolve) => {
          resolveAnalysis = resolve;
        })
    );

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // User sees skip waiting shortcut while interpreting
    const skipBtn = await screen.findByRole("button", { name: /Skip waiting & draft manually/i });
    expect(skipBtn).toBeTruthy();

    await user.click(skipBtn);

    // Navigates to review draft immediately without waiting
    expect(screen.getByText("Review issue draft")).toBeTruthy();

    // Clean up unresolved promise
    resolveAnalysis({ success: false, error: "Aborted", code: "API_ERROR" });
  });

  it("preserves existing understanding and displays user-friendly error when update with correction fails", async () => {
    const user = userEvent.setup();

    // Initial analysis succeeds
    mockedInterpretVisual.mockResolvedValueOnce({
      success: true,
      understanding: {
        observedBehavior: "Initial observed behavior on project settings page",
        context: "Settings view",
        intent: "Report settings configuration issue",
        isAmbiguous: false,
      },
      draft: {
        title: "Initial Settings Issue",
        description: "## Summary\nInitial settings issue.\n\n## Steps to Reproduce\n1. Open settings.",
        suggestedType: "Bug",
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));
    await user.click(screen.getByRole("button", { name: "Stop recording" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Record again/i })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Verifies initial understanding is displayed
    await waitFor(() => {
      expect(screen.getByText("Initial observed behavior on project settings page")).toBeTruthy();
    });

    // Open clarification
    await user.click(screen.getByRole("button", { name: /\+ Clarify or correct/i }));
    const correctionInput = screen.getByPlaceholderText(/Actually, the bug only happens/i);
    await user.type(correctionInput, "Actually, this only occurs in dark mode");

    // Mock update failure with raw JSON/schema error
    mockedInterpretVisual.mockResolvedValueOnce({
      success: false,
      error: 'Live AI interpretation failed: [{"expected":"string","code":"invalid_type","path":["context"],"message":"Required"}]',
      code: "API_ERROR",
    });

    await user.click(screen.getByRole("button", { name: /Update with correction/i }));

    // Verifies that the previous understanding is PRESERVED, not wiped out!
    await waitFor(() => {
      expect(screen.getByText("Initial observed behavior on project settings page")).toBeTruthy();
    });

    // Verifies that a human-friendly error notice is displayed without raw JSON
    expect(screen.getByText("Could not update with correction")).toBeTruthy();
    expect(screen.queryByText(/\[\{"expected":"string"/)).toBeNull();
    expect(screen.getByText(/The AI analysis response was incomplete or formatted unexpectedly/i)).toBeTruthy();

    // User can still proceed to review with the preserved draft
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));
    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Initial Settings Issue");
  });

  it("restores original modal positioning and ensures isolated scrollability for Details and Review steps", async () => {
    const user = userEvent.setup();
    const { container } = render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();

    // Dialog retains native top-layer layout without breaking flex overrides
    expect(dialog?.className).toContain("max-w-[620px]");
    expect(dialog?.className).toContain("overflow-hidden");
    expect(dialog?.className).toContain("backdrop:bg-slate-900/40");
    expect(dialog?.className).not.toContain("max-h-[min(90vh,840px)]");

    // Choose step has natural layout without outer wrapper scrolling
    const outerWrapper = dialog?.querySelector(".relative.flex.flex-col.p-6");
    expect(outerWrapper).toBeTruthy();
    expect(outerWrapper?.className).not.toContain("overflow-y-auto");

    // Advance to review via 'Write description'
    await user.click(screen.getByText("Write description").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Review step body has isolated scroll container to protect header and submit footer
    const reviewScrollBody = dialog?.querySelector(".max-h-\\[min\\(54vh\\,480px\\)\\]");
    expect(reviewScrollBody).toBeTruthy();
    expect(reviewScrollBody?.className).toContain("overflow-y-auto");
  });

  it("supports area capture, accurate cropping dimensions, and screenshot preview across steps", async () => {
    const user = userEvent.setup();
    const mockTrack = { stop: vi.fn(), onended: null };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
      getVideoTracks: vi.fn(() => [mockTrack]),
    };

    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    // Select Capture area
    await user.click(screen.getByText("Capture area").closest("button")!);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Ready to capture area")).toBeTruthy();

    // Trigger capture
    await user.click(screen.getByRole("button", { name: "Capture screen" }));

    // AreaCropper should open
    await waitFor(() => {
      expect(screen.getByText("Click and drag over the image to crop the problem area")).toBeTruthy();
    });

    // Use full screenshot or crop
    await user.click(screen.getByRole("button", { name: "Use full screenshot" }));

    // Shows screenshot preview with Retake and Continue
    await waitFor(() => {
      expect(screen.getByAltText("Captured screenshot")).toBeTruthy();
      expect(screen.getByRole("button", { name: /Retake/i })).toBeTruthy();
    }, { timeout: 15000 });

    // Advance to details
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Verifies Details step displays targeted screenshot evidence card
    await waitFor(() => {
      expect(screen.getByText("Targeted screenshot captured")).toBeTruthy();
    });

    // Advance to review
    await user.click(screen.getByRole("button", { name: /Confirm & continue to draft/i }));
    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect(screen.getByAltText("Captured evidence")).toBeTruthy();
  });
}, 20000);
