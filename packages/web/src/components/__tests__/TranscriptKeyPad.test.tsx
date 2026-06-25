import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptKeyPad } from "../TranscriptKeyPad";

afterEach(() => window.localStorage.clear());

describe("TranscriptKeyPad", () => {
  it("sends a single token per key press", () => {
    const onKeys = vi.fn();
    render(<TranscriptKeyPad onKeys={onKeys} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter" }));
    expect(onKeys).toHaveBeenCalledWith(["Enter"]);
    fireEvent.click(screen.getByRole("button", { name: "Space" }));
    expect(onKeys).toHaveBeenCalledWith(["Space"]);
    fireEvent.click(screen.getByRole("button", { name: "Digit 2" }));
    expect(onKeys).toHaveBeenCalledWith(["2"]);
    fireEvent.click(screen.getByRole("button", { name: "Ctrl-C" }));
    expect(onKeys).toHaveBeenCalledWith(["C-c"]);
  });

  it("collapses and expands via the header toggle", () => {
    render(<TranscriptKeyPad onKeys={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enter" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle keys" }));
    expect(screen.queryByRole("button", { name: "Enter" })).not.toBeInTheDocument();
  });
});
