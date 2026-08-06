"use client";

import { useEffect, useState } from "react";
import type { CatalogSummary } from "@touhouflandre/shared";
import { api } from "../lib/api";

export function useCatalogSummary() {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .catalog(controller.signal)
      .then(setSummary)
      .catch(() => setSummary(null));
    return () => controller.abort();
  }, []);

  return summary;
}
