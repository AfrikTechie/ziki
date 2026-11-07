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

  it("preserves full edge coordinates and extracts exact source image region without clipping", async () => {
    const onCropComplete = vi.fn();
    const mockDrawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: mockDrawImage,
    })) as never;

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

    const img = screen.getByAltText("Screenshot to crop") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 1920, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1080, configurable: true });
    Object.defineProperty(img, "clientWidth", { value: 640, configurable: true });
    Object.defineProperty(img, "clientHeight", { value: 360, configurable: true });

    vi.spyOn(cropContainer!, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 360,
      bottom: 360,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Select from x=10 to x=630 (width=620, height=320)
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerdown", { clientX: 10, clientY: 20, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointermove", { clientX: 630, clientY: 340, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerup", { clientX: 630, clientY: 340, bubbles: true, cancelable: true })
    );

    const cropBtn = screen.getByRole("button", { name: "Crop area" });
    fireEvent.click(cropBtn);

    expect(onCropComplete).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    const [calledImg, sx, sy, sw, sh] = mockDrawImage.mock.calls[0];
    expect(calledImg).toBe(img);
    // scale factor is 1920 / 640 = 3
    expect(sx).toBe(30);
    expect(sy).toBe(60);
    expect(sw).toBe(1860);
    expect(sh).toBe(960);
    expect(onCropComplete).toHaveBeenCalledWith(expect.any(Blob), expect.any(String), 1860, 960);
  });

  it("accurately crops letterboxed wide images preserving aspect ratio without distortion or clipping", async () => {
    const onCropComplete = vi.fn();
    const mockDrawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: mockDrawImage,
    })) as never;

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
    const img = screen.getByAltText("Screenshot to crop") as HTMLImageElement;

    // Wide 2:1 aspect ratio image (2000x1000) inside 500x350 container (letterboxed top & bottom)
    Object.defineProperty(img, "naturalWidth", { value: 2000, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 1000, configurable: true });

    vi.spyOn(cropContainer!, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      width: 500,
      height: 350,
      bottom: 360,
      right: 510,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    vi.spyOn(img, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 10,
      width: 500,
      height: 350,
      bottom: 360,
      right: 510,
      x: 10,
      y: 10,
      toJSON: () => {},
    });

    // In a 500x350 box with 2:1 aspect ratio, painted height is 250px.
    // Vertical letterbox offset is (350 - 250) / 2 = 50px.
    // Client click at top: 10 + 50 (offset) + 20px into image = 80px.
    // Drag down to 80 + 100px into image = 180px.
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerdown", { clientX: 10 + 50, clientY: 10 + 50 + 20, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointermove", { clientX: 10 + 250, clientY: 10 + 50 + 120, bubbles: true, cancelable: true })
    );
    fireEvent(
      cropContainer!,
      new PointerEvent("pointerup", { clientX: 10 + 250, clientY: 10 + 50 + 120, bubbles: true, cancelable: true })
    );

    const cropBtn = screen.getByRole("button", { name: "Crop area" });
    fireEvent.click(cropBtn);

    expect(onCropComplete).toHaveBeenCalledTimes(1);
    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    const [, sx, sy, sw, sh] = mockDrawImage.mock.calls[0];
    // Scale factor is 2000 / 500 = 4.
    // Selected x: 50 to 250 (width 200) -> 200 * 4 = 800.
    // Selected y: 20 to 120 (height 100) -> 100 * 4 = 400.
    expect(sx).toBe(200);
    expect(sy).toBe(80);
    expect(sw).toBe(800);
    expect(sh).toBe(400);
    expect(onCropComplete).toHaveBeenCalledWith(expect.any(Blob), expect.any(String), 800, 400);
  });
});
