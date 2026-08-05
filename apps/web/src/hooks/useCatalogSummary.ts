import { useEffect, useState } from "react";
import type { CatalogSummary } from "@touhoufriberg/shared";
import { api } from "../lib/api";

export function useCatalogSummary() {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .catalog(controller.signal)
      .then(setSummary)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return summary;
}
