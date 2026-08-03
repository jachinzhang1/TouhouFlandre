import { useEffect, useState } from "react";
import type { CatalogSummary } from "@touhoufriberg/shared";
import { requestJson } from "../api";

export function useCatalogSummary() {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<CatalogSummary>("/api/catalog", {
      signal: controller.signal,
    })
      .then(setSummary)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return summary;
}
