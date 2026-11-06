// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddIdeaModal } from "@/components/add-idea-modal";
import { createBugAction } from "@/app/actions/issues";
import { interpretVisualEvidenceAction } from "@/app/actions/visual-interpretation";
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
});
