"use client";

import { Agentation } from "agentation";

export function AgentationToolbar() {
  return (
    <div data-agentation-toolbar>
      <Agentation endpoint="http://localhost:4747" />
    </div>
  );
}
