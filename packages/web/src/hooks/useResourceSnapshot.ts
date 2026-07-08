"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResourceSnapshot } from "@/lib/resource-types";

export function useResourceSnapshot(): {
  data: ResourceSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<ResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/resources");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ResourceSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load resources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
