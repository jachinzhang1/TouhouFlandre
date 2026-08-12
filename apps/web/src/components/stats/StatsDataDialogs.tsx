"use client";

import { X } from "lucide-react";

export function ConfirmStatsClearDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      role="presentation"
    >
      <section
        className="w-full max-w-[430px] rounded-[7px] border border-line bg-[var(--surface)] p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="confirm-title" className="text-lg font-black text-ink">
              清除全部统计数据？
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              完成记录和进行中的统计草稿将被删除，当前单人或多人游戏进度不会被清除。
            </p>
          </div>
          <CloseButton onClick={onCancel} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-[5px] border border-line px-4 text-sm font-bold text-ink"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)]"
            onClick={() => void onConfirm()}
          >
            确认清除
          </button>
        </div>
      </section>
    </div>
  );
}

export function StatsImportDialog({
  preview,
  onClose,
  onApply,
}: {
  preview: { total: number; additions: number; replacements: number };
  onClose: () => void;
  onApply: (mode: "merge" | "replace") => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <section
        className="w-full max-w-[460px] rounded-[7px] border border-line bg-[var(--surface)] p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="import-title" className="text-lg font-black text-ink">
              导入统计数据
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              已校验 {preview.total} 条记录
            </p>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[5px] bg-jade-soft p-3">
            <dt className="text-xs font-bold text-jade">新增</dt>
            <dd className="mt-1 text-xl font-black text-ink">
              {preview.additions}
            </dd>
          </div>
          <div className="rounded-[5px] bg-amber-soft p-3">
            <dt className="text-xs font-bold text-amber">同 ID 更新</dt>
            <dd className="mt-1 text-xl font-black text-ink">
              {preview.replacements}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-5 text-ink-soft">
          合并会保留其他现有记录；覆盖会清空现有统计后导入，并再次要求确认。
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-[5px] border border-line px-4 text-sm font-bold text-ink"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] border border-vermilion px-4 text-sm font-bold text-vermilion"
            onClick={() => void onApply("replace")}
          >
            覆盖导入
          </button>
          <button
            type="button"
            className="h-9 rounded-[5px] bg-jade px-4 text-sm font-bold text-white"
            onClick={() => void onApply("merge")}
          >
            合并导入
          </button>
        </div>
      </section>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] text-ink-soft hover:bg-[var(--surface-soft)]"
      title="关闭"
      aria-label="关闭"
      onClick={onClick}
    >
      <X size={18} />
    </button>
  );
}
