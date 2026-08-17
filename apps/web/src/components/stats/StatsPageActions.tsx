"use client";

import { useRef, type ChangeEventHandler } from "react";
import { Download, Trash2, Upload, type LucideIcon } from "lucide-react";
import { PageHeaderAction } from "../layout/PageHeader";

interface StatsPageActionsProps {
  onClear: () => void;
  onExport: () => void | Promise<void>;
  onImport: (file: File) => void | Promise<void>;
}

export function StatsPageActions({
  onClear,
  onExport,
  onImport,
}: StatsPageActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleImport: ChangeEventHandler<HTMLInputElement> = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        await onImport(file);
      } finally {
        input.value = "";
      }
    })();
  };

  return (
    <div className="stats-page-actions">
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={handleImport}
      />
      <StatsActionButton
        icon={Download}
        label="导出"
        onClick={() => void onExport()}
      />
      <StatsActionButton
        icon={Upload}
        label="导入"
        onClick={() => fileInputRef.current?.click()}
      />
      <StatsActionButton
        icon={Trash2}
        label="清除数据"
        onClick={onClear}
        tone="danger"
      />
    </div>
  );
}

function StatsActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "plain",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "plain" | "danger";
}) {
  return (
    <PageHeaderAction ariaLabel={label} onClick={onClick} tone={tone}>
      <Icon size={18} aria-hidden="true" />
      <span className="stats-action-label">{label}</span>
    </PageHeaderAction>
  );
}
