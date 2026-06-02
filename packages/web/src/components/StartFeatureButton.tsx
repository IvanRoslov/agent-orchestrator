"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { projectSessionPath } from "@/lib/routes";

interface StartFeatureButtonProps {
  projectId: string;
  projectName: string;
}

/**
 * Header action that kicks the hub project's orchestrator into cross-project
 * feature mode (POST /api/feature/start) and opens its terminal. The feature
 * description is given to the orchestrator in chat, so no input is collected
 * here.
 */
export function StartFeatureButton({ projectId, projectName }: StartFeatureButtonProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/feature/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      const data = (await res.json().catch(() => null)) as {
        orchestrator?: { id: string; projectId: string };
        error?: string;
      } | null;

      if (!res.ok || !data?.orchestrator) {
        throw new Error(data?.error ?? `Failed to start feature for ${projectName}`);
      }

      router.push(projectSessionPath(data.orchestrator.projectId, data.orchestrator.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start feature";
      setError(message);
      console.error(`Failed to start feature for ${projectId}:`, err);
    } finally {
      setStarting(false);
    }
  };

  const label = starting ? "Starting…" : error ? "Retry feature" : "Start feature";

  return (
    <button
      type="button"
      className="dashboard-app-btn"
      aria-label="Start feature"
      onClick={() => void handleClick()}
      disabled={starting}
      title={error ?? undefined}
      aria-invalid={error ? true : undefined}
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
      {label}
    </button>
  );
}
