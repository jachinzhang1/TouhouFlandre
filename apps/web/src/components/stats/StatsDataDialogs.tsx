"use client";

import { X } from "lucide-react";
import { Paper } from "../Paper";
import { PaperButton } from "../controls/PaperButton";

export function ConfirmStatsClearDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="stats-dialog-backdrop" role="presentation">
      <section
        className="stats-dialog-shell max-w-[430px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <Paper
          animateOnMount={false}
          as="div"
          className="stats-dialog-paper"
          foldSize={18}
          sticker={false}
          unfoldOnHover
        >
          <div className="stats-dialog-heading">
            <div>
              <h2 id="confirm-title">清除全部统计数据？</h2>
              <p>
                完成记录和进行中的统计草稿将被删除，当前单人或多人游戏进度不会被清除。
              </p>
            </div>
            <CloseButton onClick={onCancel} />
          </div>
          <div className="stats-dialog-actions">
            <PaperButton onClick={onCancel}>取消</PaperButton>
            <PaperButton filled onClick={() => void onConfirm()} tone="danger">
              确认清除
            </PaperButton>
          </div>
        </Paper>
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
    <div className="stats-dialog-backdrop">
      <section
        className="stats-dialog-shell max-w-[460px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <Paper
          animateOnMount={false}
          as="div"
          className="stats-dialog-paper"
          foldSize={18}
          sticker={false}
          unfoldOnHover
        >
          <div className="stats-dialog-heading">
            <div>
              <h2 id="import-title">导入统计数据</h2>
              <p>已校验 {preview.total} 条记录。</p>
            </div>
            <CloseButton onClick={onClose} />
          </div>
          <dl className="stats-import-summary">
            <Paper
              animateOnMount={false}
              as="div"
              className="stats-import-count stats-import-count-new"
              foldSize={10}
              stackOrder={2}
              sticker
              unfoldOnHover
            >
              <dt>新增</dt>
              <dd>{preview.additions}</dd>
            </Paper>
            <Paper
              animateOnMount={false}
              as="div"
              className="stats-import-count stats-import-count-update"
              foldSize={10}
              stackOrder={1}
              sticker
              unfoldOnHover
            >
              <dt>同 ID 更新</dt>
              <dd>{preview.replacements}</dd>
            </Paper>
          </dl>
          <p className="stats-dialog-note">
            合并会保留其他现有记录；覆盖会清空现有统计后导入，并再次要求确认。
          </p>
          <div className="stats-dialog-actions stats-dialog-actions-wrap">
            <PaperButton onClick={onClose}>取消</PaperButton>
            <PaperButton
              filled
              onClick={() => void onApply("replace")}
              tone="danger"
            >
              覆盖导入
            </PaperButton>
            <PaperButton
              filled
              onClick={() => void onApply("merge")}
              tone="jade"
            >
              合并导入
            </PaperButton>
          </div>
        </Paper>
      </section>
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="关闭"
      className="stats-dialog-close"
      onClick={onClick}
      title="关闭"
      type="button"
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}
