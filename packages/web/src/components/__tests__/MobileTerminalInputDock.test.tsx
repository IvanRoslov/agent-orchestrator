import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeTerminal = vi.fn();
vi.mock("@/providers/MuxProvider", () => ({
  useMux: () => ({ writeTerminal }),
}));

let speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => speech,
}));

import { MobileTerminalInputDock } from "../MobileTerminalInputDock";

beforeEach(() => {
  writeTerminal.mockReset();
  speech = { supported: true, listening: false, start: vi.fn(), stop: vi.fn() };
});

function renderDock() {
  return render(<MobileTerminalInputDock sessionId="app-1" projectId="proj" />);
}

describe("MobileTerminalInputDock", () => {
  it("sends each special key as its byte sequence to the PTY", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Escape" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x1b", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Ctrl-C" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x03", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\x1b[A", "proj");
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "\r", "proj");
  });

  it("sends typed text followed by Enter and clears the input", () => {
    renderDock();
    const input = screen.getByPlaceholderText("Message…") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "npm test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(writeTerminal).toHaveBeenCalledWith("app-1", "npm test\r", "proj");
    expect(input.value).toBe("");
  });

  it("does not send when the input is empty", () => {
    renderDock();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(writeTerminal).not.toHaveBeenCalled();
  });

  it("shows the mic button only when speech is supported", () => {
    const { unmount } = renderDock();
    expect(screen.getByRole("button", { name: "Voice input" })).toBeInTheDocument();
    unmount();
    speech = { supported: false, listening: false, start: vi.fn(), stop: vi.fn() };
    renderDock();
    expect(screen.queryByRole("button", { name: "Voice input" })).not.toBeInTheDocument();
  });
});
