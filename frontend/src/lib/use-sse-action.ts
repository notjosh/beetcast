import type { z } from "zod/v4";

import { useCallback, useRef, useState } from "react";

interface SSESchemas<TProgress, TResult> {
  error: z.ZodType<{ message: string }>;
  progress: z.ZodType<TProgress>;
  result: z.ZodType<TResult>;
}

export function useSSEAction<TProgress, TResult>(
  url: string,
  schemas: SSESchemas<TProgress, TResult>,
) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<null | TProgress>(null);
  const [result, setResult] = useState<null | TResult>(null);
  const [error, setError] = useState<null | string>(null);
  const abortRef = useRef<AbortController | null>(null);

  const execute = useCallback(async () => {
    setRunning(true);
    setProgress(null);
    setResult(null);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setError(`Request failed: ${response.status}`);
        setRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let currentEvent = "";
        let currentData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            currentData = line.slice(6);
          } else if (line === "" && currentData) {
            const raw: unknown = JSON.parse(currentData);
            if (currentEvent === "progress") {
              setProgress(schemas.progress.parse(raw));
            } else if (currentEvent === "complete") {
              setResult(schemas.result.parse(raw));
            } else if (currentEvent === "error") {
              setError(schemas.error.parse(raw).message);
            }
            currentEvent = "";
            currentData = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [url, schemas]);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { abort, error, execute, progress, result, running };
}
