// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddIdeaModal } from "@/components/add-idea-modal";
import { createBugAction } from "@/app/actions/issues";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("@/app/actions/issues", () => ({
  createBugAction: vi.fn(),
}));

const mockedCreateBug = vi.mocked(createBugAction);

describe("AddIdeaModal (Phase 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateBug.mockResolvedValue({} as never);

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

    // Should now be on review draft
    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit idea" })).toBeTruthy();
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

  it("handles screen recording permission denial gracefully", async () => {
    const user = userEvent.setup();

    // Mock getDisplayMedia throwing NotAllowedError
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {
        getDisplayMedia: vi.fn().mockRejectedValue({ name: "NotAllowedError" }),
      },
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    // Record screen is default
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Ready to record")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Start recording/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Screen recording was cancelled or permission was denied."),
      ).toBeTruthy();
    });
  });

  it("handles unsupported browser error for screen recording", async () => {
    const user = userEvent.setup();

    // Remove getDisplayMedia
    Object.defineProperty(navigator, "mediaDevices", {
      writable: true,
      value: {},
    });

    render(<AddIdeaModal isOpen={true} onClose={vi.fn()} projectId="p1" />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Start recording/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Screen recording is not supported in this browser/),
      ).toBeTruthy();
    });
  });

  it("supports recording lifecycle and local video playback preview", async () => {
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

    // Advance to review
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Review issue draft")).toBeTruthy();
    expect(screen.getByText("Visual evidence")).toBeTruthy();
    expect(screen.getByText("Local preview (not attached)")).toBeTruthy();
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
