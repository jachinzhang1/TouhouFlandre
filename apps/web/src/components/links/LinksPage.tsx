"use client";

import { PageHeader } from "../layout/PageHeader";
import { CreditSection } from "./CreditSection";
import { creditSections } from "./creditData";

export function LinksPage() {
  return (
    <section className="links-page">
      <PageHeader
        description="感谢为本项目提供创作资源与帮助的作者。"
        title="友链与鸣谢"
      />
      {creditSections.map((section) => (
        <CreditSection key={section.title} {...section} />
      ))}
    </section>
  );
}
