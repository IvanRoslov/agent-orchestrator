import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TranscriptMessageList } from "../TranscriptMessageList";
import type { TranscriptEntry } from "@/lib/transcript-types";

const entries: TranscriptEntry[] = [
  { kind: "message", role: "user", text: "fix it" },
  { kind: "message", role: "assistant", text: "on it" },
  { kind: "tool_use", name: "Bash", input: '{"command":"npm test"}' },
  { kind: "tool_result", text: "2 passed", isError: false },
];

describe("TranscriptMessageList", () => {
  it("renders messages and a collapsed tool call that expands on click", () => {
    render(<TranscriptMessageList entries={entries} />);
    expect(screen.getByText("fix it")).toBeInTheDocument();
    expect(screen.getByText("on it")).toBeInTheDocument();
    expect(screen.getByText(/Bash/)).toBeInTheDocument();
    expect(screen.queryByText(/npm test/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bash/ }));
    expect(screen.getByText(/npm test/)).toBeInTheDocument();
  });

  it("collapses tool results until clicked", () => {
    render(<TranscriptMessageList entries={entries} />);
    // Result content hidden until expanded.
    expect(screen.queryByText("2 passed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Result/ }));
    expect(screen.getByText("2 passed")).toBeInTheDocument();
  });

  it("labels an error tool result with the error color token", () => {
    render(
      <TranscriptMessageList
        entries={[{ kind: "tool_result", text: "boom", isError: true }]}
      />,
    );
    const header = screen.getByRole("button", { name: /Error/ }).parentElement;
    expect(header?.className).toContain("var(--color-status-error)");
    fireEvent.click(screen.getByRole("button", { name: /Error/ }));
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
