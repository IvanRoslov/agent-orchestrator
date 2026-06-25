import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
vi.mock("@/hooks/useSpeechRecognition", () => ({ useSpeechRecognition: () => speech }));

import { TranscriptComposer } from "../TranscriptComposer";

beforeEach(() => {
  speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
});

describe("TranscriptComposer", () => {
  it("sends typed text and clears", () => {
    const onSend = vi.fn();
    render(<TranscriptComposer onSend={onSend} />);
    const input = screen.getByPlaceholderText("Message…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "deploy please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("deploy please");
    expect(input.value).toBe("");
  });

  it("submits on Enter without shift, but not with shift", () => {
    const onSend = vi.fn();
    render(<TranscriptComposer onSend={onSend} />);
    const input = screen.getByPlaceholderText("Message…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "ship it" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("ship it");
  });

  it("does not send empty and shows mic only when supported", () => {
    const onSend = vi.fn();
    const { unmount } = render(<TranscriptComposer onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Voice input" })).toBeInTheDocument();
    unmount();
    speech = { supported: false, listening: false, start: vi.fn(), stop: vi.fn() };
    render(<TranscriptComposer onSend={onSend} />);
    expect(screen.queryByRole("button", { name: "Voice input" })).not.toBeInTheDocument();
  });
});
