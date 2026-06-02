"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { projectSessionPath } from "@/lib/routes";

interface StartFeatureButtonProps {
  projectId: string;
  projectName: string;
}

/**
 * Header action that starts a cross-project feature. Collects a short feature
 * name, then spawns a DEDICATED feature-orchestrator session (POST
 * /api/feature/start) and opens its terminal. The standard project orchestrator
 * is left untouched, and several features can run in parallel.
 */
export function StartFeatureButton({ projectId, projectName }: StartFeatureButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setSubmitting(false);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feature/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as {
        feature?: { sessionId: string; projectId: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.feature) {
        throw new Error(data?.error ?? `Failed to start feature for ${projectName}`);
      }
      setOpen(false);
      router.push(projectSessionPath(data.feature.projectId, data.feature.sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start feature");
    } finally {
      setSubmitting(false);
    }
  }, [name, projectId, projectName, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Enter" && canSubmit) {
        event.preventDefault();
        void submit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, canSubmit, submit]);

  return (
    <>
      <button
        type="button"
        className="dashboard-app-btn"
        aria-label="Start feature"
        onClick={() => setOpen(true)}
      >
        <svg
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M5 21V4h12l-2.5 4 2.5 4H5" />
        </svg>
        Start feature
      </button>

      {open ? (
        <div className="add-project-modal-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Start feature"
            className="add-project-modal"
            tabIndex={-1}
          >
            <div className="add-project-modal__titlebar">
              <h2 className="add-project-modal__windowtitle">start feature</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="add-project-modal__iconbtn"
              >
                ×
              </button>
            </div>

            <div className="add-project-modal__pathbar add-project-modal__formrow">
              <div className="add-project-modal__field">
                <label className="add-project-modal__selection-label" htmlFor="feature-name-input">
                  Feature name
                </label>
                <input
                  id="feature-name-input"
                  ref={inputRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. SSO login across web and API"
                  className="add-project-modal__selection-path"
                />
              </div>
            </div>

            {error ? (
              <div role="alert" className="add-project-modal__notice add-project-modal__notice--error">
                {error}
              </div>
            ) : null}

            <div className="add-project-modal__footer">
              <div className="add-project-modal__foldercount">
                Spawns a feature orchestrator in {projectName}
              </div>
              <div className="add-project-modal__actions">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="add-project-modal__ghostbtn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="add-project-modal__primarybtn"
                >
                  {submitting ? "Starting…" : "Start feature"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
