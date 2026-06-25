import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromptCard } from "../PromptCard";
import type { TranscriptPrompt } from "@/lib/transcript-types";

const prompt: TranscriptPrompt = {
  question: "Proceed?",
  options: [
    { index: 1, label: "Yes" },
    { index: 2, label: "No" },
  ],
  raw: "Proceed?\n1. Yes\n2. No",
};

describe("PromptCard", () => {
  it("sends the option index (+Enter) when an option is tapped", () => {
    const onKeys = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "2. No" }));
    expect(onKeys).toHaveBeenCalledWith(["2", "Enter"]);
  });

  it("submits a free-text answer", () => {
    const onAnswer = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={vi.fn()} onAnswer={onAnswer} onDiscuss={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Your answer…"), { target: { value: "do X" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(onAnswer).toHaveBeenCalledWith("do X");
  });

  it("interrupts with Escape and routes Discuss", () => {
    const onKeys = vi.fn();
    const onDiscuss = vi.fn();
    render(<PromptCard prompt={prompt} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={onDiscuss} />);
    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));
    expect(onKeys).toHaveBeenCalledWith(["Escape"]);
    fireEvent.click(screen.getByRole("button", { name: "Chat it" }));
    expect(onDiscuss).toHaveBeenCalled();
  });

  it("falls back to Approve/Deny when there are no options", () => {
    const onKeys = vi.fn();
    render(
      <PromptCard prompt={{ ...prompt, options: [] }} onKeys={onKeys} onAnswer={vi.fn()} onDiscuss={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onKeys).toHaveBeenCalledWith(["Enter"]);
  });
});
