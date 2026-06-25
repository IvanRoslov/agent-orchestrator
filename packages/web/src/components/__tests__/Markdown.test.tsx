import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../Markdown";

describe("Markdown", () => {
  it("renders headings, bold, inline code and links", () => {
    render(
      <Markdown text={"# Title\n\nSome **bold** and `code` and [link](https://x.test)."} />,
    );
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://x.test");
  });

  it("renders ordered and unordered lists", () => {
    render(<Markdown text={"- one\n- two\n\n1. first\n2. second"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("one").closest("ul")).toBeInTheDocument();
    expect(screen.getByText("first").closest("ol")).toBeInTheDocument();
  });

  it("renders fenced code blocks verbatim", () => {
    render(<Markdown text={"```\nconst x = 1;\n```"} />);
    expect(screen.getByText("const x = 1;").tagName).toBe("PRE");
  });
});
