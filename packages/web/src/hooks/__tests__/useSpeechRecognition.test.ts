import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSpeechRecognition } from "../useSpeechRecognition";

class FakeRecognition {
  interimResults = false;
  continuous = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSpeechRecognition", () => {
  it("reports unsupported when the API is absent", () => {
    vi.stubGlobal("isSecureContext", true);
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it("reports unsupported in an insecure context even if the API exists", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    expect(result.current.supported).toBe(false);
  });

  it("starts listening and streams transcripts when supported", () => {
    vi.stubGlobal("isSecureContext", true);
    const instances: FakeRecognition[] = [];
    class Tracked extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", Tracked);
    const onTranscript = vi.fn();

    const { result } = renderHook(() => useSpeechRecognition(onTranscript));
    expect(result.current.supported).toBe(true);

    act(() => result.current.start());
    expect(result.current.listening).toBe(true);
    expect(instances[0].start).toHaveBeenCalled();

    act(() => {
      instances[0].onresult?.({
        resultIndex: 0,
        results: [Object.assign([{ transcript: "run the tests" }], { isFinal: true })],
      });
    });
    expect(onTranscript).toHaveBeenCalledWith("run the tests", true);

    act(() => result.current.stop());
    expect(result.current.listening).toBe(false);
  });

  it("aborts and detaches the previous instance on double-start", () => {
    vi.stubGlobal("isSecureContext", true);
    const instances: FakeRecognition[] = [];
    class Tracked extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", Tracked);

    const { result } = renderHook(() => useSpeechRecognition(() => {}));
    act(() => result.current.start());
    act(() => result.current.start());

    expect(instances).toHaveLength(2);
    expect(instances[0].abort).toHaveBeenCalled();
    // The first instance's onend was detached, so firing it must NOT flip listening.
    act(() => instances[0].onend?.());
    expect(result.current.listening).toBe(true);
  });
});
