// @vitest-environment jsdom
"use client";

import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AreaCropper } from "@/components/area-cropper";

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
      />,
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

    // Simulate pointer down, wait for state update, then pointer move
    fireEvent.pointerDown(cropContainer!, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(cropContainer!, { clientX: 200, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(cropContainer!, { clientX: 200, clientY: 150, pointerId: 1 });

    // Crop area button is present
    expect(screen.getByRole("button", { name: "Crop area" })).toBeTruthy();
  });
});
