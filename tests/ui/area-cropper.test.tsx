// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AreaCropper } from "@/components/area-cropper";

// jsdom does not define PointerEvent by default, causing synthetic events to lack clientX/clientY
if (typeof window !== "undefined" && !window.PointerEvent) {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof window.PointerEvent;
}

describe("AreaCropper (Phase 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:http://localhost/cropped-blob");
    globalThis.URL.revokeObjectURL = vi.fn();

    // Mock HTMLCanvasElement.toBlob and getContext in jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as never;

    HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      callback(new Blob(["cropped-image"], { type: "image/png" }));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders instructions and action buttons", () => {
    render(
      <AreaCropper
        imageSrc="data:image/png;base64,mock"
        onCropComplete={vi.fn()}
        onUseFull={vi.fn()}
        onRetake={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Click and drag over the image to crop the problem area")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retake/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use full screenshot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crop area" })).toBeTruthy();
  });

  it("calls onUseFull when 'Use full screenshot' is clicked", async () => {
    const onUseFull = vi.fn();
    const user = userEvent.setup();

    render(
      <AreaCropper
        imageSrc="data:image/png;base64,mock"
        onCropComplete={vi.fn()}
        onUseFull={onUseFull}
        onRetake={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Use full screenshot" }));
    expect(onUseFull).toHaveBeenCalledTimes(1);
  });

  it("calls onRetake when 'Retake' is clicked", async () => {
    const onRetake = vi.fn();
    const user = userEvent.setup();

    render(
      <AreaCropper
        imageSrc="data:image/png;base64,mock"
        onCropComplete={vi.fn()}
        onUseFull={vi.fn()}
        onRetake={onRetake}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Retake/i }));
    expect(onRetake).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when 'Cancel' is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(
      <AreaCropper
        imageSrc="data:image/png;base64,mock"
        onCropComplete={vi.fn()}
        onUseFull={vi.fn()}
        onRetake={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("supports interactive pointer drag to select area", async () => {
    const onCropComplete = vi.fn();
    const { container } = render(
      <AreaCropper
        imageSrc="data:image/png;base64,mock"
        onCropComplete={onCropComplete}
        onUseFull={vi.fn()}
        onRetake={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const cropContainer = container.querySelector(".cursor-crosshair");
    expect(cropContainer).not.toBeNull();

    // Mock client rect
    vi.spyOn(cropContainer!, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 300,
      bottom: 300,
      right: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Simulate pointer down, pointer move, pointer up with coordinates
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerdown", { clientX: 50, clientY: 50, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointermove", { clientX: 200, clientY: 150, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerup", { clientX: 200, clientY: 150, bubbles: true, cancelable: true })
    );

    // Crop area button is present and enabled
    const cropBtn = screen.getByRole("button", { name: "Crop area" });
    expect(cropBtn).toBeTruthy();
    expect(cropBtn.hasAttribute("disabled")).toBe(false);

    // Click crop
    fireEvent.click(cropBtn);
    expect(onCropComplete).toHaveBeenCalledTimes(1);
  });
});
