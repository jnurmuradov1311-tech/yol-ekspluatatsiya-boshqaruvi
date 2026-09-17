"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

export function useApiResource<T>(loader: () => Promise<T>, resourceKey = "initial") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const reload = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const nextData = await loaderRef.current();
      if (requestGeneration !== requestGenerationRef.current) return;
      setData(nextData);
    } catch (caught) {
      if (requestGeneration !== requestGenerationRef.current) return;
      setError(caught instanceof Error ? caught : new Error("Noma’lum xato"));
    } finally {
      if (requestGeneration === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void reload(), 0);
    return () => {
      window.clearTimeout(task);
      requestGenerationRef.current += 1;
    };
  }, [reload, resourceKey]);

  return { data, error, loading, reload, setData };
}
