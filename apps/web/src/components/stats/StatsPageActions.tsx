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
        icon={Upload}
        label="导出"
        onClick={() => void onExport()}
      />
      <StatsActionButton
        icon={Download}
        label="导入"
        onClick={() => fileInputRef.current?.click()}
      />
      <StatsActionButton
        danger
        icon={Trash2}
        label="清除数据"
        onClick={onClear}
      />
    </div>
  );
}

function StatsActionButton({
  danger = false,
  icon: Icon,
  label,
  onClick,
}: {
  danger?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <PageHeaderAction
      ariaLabel={label}
      onClick={onClick}
      tone={danger ? "danger" : "plain"}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="stats-action-label">{label}</span>
    </PageHeaderAction>
  );
}
