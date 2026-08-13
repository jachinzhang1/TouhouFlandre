"use client";

import { Download, Loader2, Settings, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfigProvider, message as globalMessage } from "antd";
import {
  normalizeQuestionScope,
  QUESTION_DIFFICULTY_LABELS,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
} from "@touhouflandre/shared";
import { QuestionScopeEditor } from "./QuestionScopeEditor";
import { api } from "../../lib/api";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
  saveLocalQuestionScope,
} from "../../lib/questionScopeStorage";

type Props = {
  open: boolean;
  initialConfig?: QuestionScopeConfig | null;
  readOnly?: boolean;
  title?: string;
  onApply?: (config: QuestionScopeConfig) => void;
  onClose: () => void;
};

type QuestionScopeExportFile = {
  kind: "touhouflandre.questionScope";
  exportedAt: string;
  questionScope: QuestionScopeConfig;
};

export function QuestionScopeDialog({
  open,
  initialConfig,
  readOnly = false,
  title = "题库设置",
  onApply,
  onClose,
}: Props) {
  const [snapshot, setSnapshot] = useState<FullCatalogSnapshot | null>(null);
  const [draft, setDraft] = useState<QuestionScopeConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const loaded = catalogFullToSnapshot(await api.catalogFull());
        if (disposed) return;
        const correction =
          initialConfig || readOnly
            ? normalizeQuestionScope(initialConfig ?? null, loaded)
            : loadLocalQuestionScope(loaded);
        setSnapshot(loaded);
        setDraft(correction.config);
        if (correction.changed && !readOnly) {
          setNotice("题库已随新版本自动整理。");
        }
      } catch (caught) {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : "题库加载失败。");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [initialConfig, open, readOnly]);

  if (!open) return null;

  const currentDifficulty = draft?.difficulty ?? "normal";
  const invalidScope = Boolean(
    !readOnly && draft && draft.selectedCharacterIds.length === 0,
  );
  const apply = () => {
    if (!snapshot || !draft || readOnly) {
      onClose();
      return;
    }
    const corrected = normalizeQuestionScope(draft, snapshot).config;
    saveLocalQuestionScope(corrected);
    onApply?.(corrected);
    onClose();
    globalMessage.success("题库修改成功，将在新游戏中生效");
  };
  const exportConfig = () => {
    if (!snapshot || !draft) return;
    const corrected = normalizeQuestionScope(draft, snapshot).config;
    const file: QuestionScopeExportFile = {
      kind: "touhouflandre.questionScope",
      exportedAt: new Date().toISOString(),
      questionScope: corrected,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `touhouflandre-question-scope-${file.exportedAt.slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const importConfig = async (file?: File) => {
    if (!file || !snapshot || readOnly) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate =
        parsed && typeof parsed === "object" && "questionScope" in parsed
          ? (parsed as { questionScope?: unknown }).questionScope
          : parsed;
      if (!candidate || typeof candidate !== "object") {
        throw new Error("文件中没有可用的题库设置。");
      }
      if (!window.confirm("当前操作将覆盖现有题库设置，是否确认导入？")) {
        return;
      }
      const correction = normalizeQuestionScope(
        candidate as Partial<QuestionScopeConfig>,
        snapshot,
      );
      saveLocalQuestionScope(correction.config);
      setDraft(correction.config);
      setNotice(
        correction.changed
          ? "导入的题库已按当前版本自动整理。"
          : "题库设置已导入。",
      );
      onApply?.(correction.config);
      globalMessage.success("题库设置导入成功");
    } catch (caught) {
      globalMessage.error(
        caught instanceof Error
          ? `题库设置导入失败：${caught.message}`
          : "题库设置导入失败。",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <ConfigProvider
        theme={{
          token: {
            borderRadius: 5,
            colorBgContainer: "var(--surface)",
            colorBorder: "var(--line)",
            colorPrimary: "var(--vermilion)",
            colorPrimaryBg: "var(--accent-soft)",
            colorPrimaryHover: "var(--vermilion-dark)",
            colorText: "var(--ink)",
            colorTextSecondary: "var(--ink-soft)",
            colorBgElevated: "var(--surface)",
            colorFillSecondary: "var(--surface-soft)",
            fontFamily: "var(--font-ui)",
          },
        }}
      >
        <section
          className="flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[8px] border border-line bg-paper shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="question-scope-title"
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <p
                className={`mb-1 text-[0.72rem] font-bold ${
                  invalidScope ? "text-[var(--error-text)]" : "text-ink-soft"
                }`}
              >
                {invalidScope
                  ? "当前题库状态无效，若应用将自动改为Normal难度"
                  : `当前难度：${QUESTION_DIFFICULTY_LABELS[currentDifficulty]}`}
              </p>
              <h2
                id="question-scope-title"
                className="text-lg font-black text-ink"
              >
                {title}
              </h2>
              {notice ? (
                <p className="mt-1 text-[0.76rem] font-semibold text-jade">
                  {notice}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-[5px] text-ink-soft hover:bg-paper-muted"
              title="关闭"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="grid min-h-[320px] place-items-center text-sm text-ink-soft">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                  正在读取题库
                </span>
              </div>
            ) : error ? (
              <div className="rounded-[6px] border border-vermilion-soft bg-vermilion-soft px-4 py-3 text-sm text-vermilion">
                {error}
              </div>
            ) : snapshot && draft ? (
              <QuestionScopeEditor
                draft={draft}
                snapshot={snapshot}
                readOnly={readOnly}
                onChange={setDraft}
              />
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            {!readOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={importInputRef}
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void importConfig(event.target.files?.[0])
                  }
                />
                <button
                  type="button"
                  disabled={!draft || !snapshot || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-3 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                  onClick={exportConfig}
                >
                  <Upload size={15} aria-hidden="true" />
                  导出
                </button>
                <button
                  type="button"
                  disabled={!snapshot || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-3 text-xs font-bold text-ink hover:bg-paper-muted disabled:cursor-default disabled:opacity-50"
                  onClick={() => importInputRef.current?.click()}
                >
                  <Download size={15} aria-hidden="true" />
                  导入
                </button>
              </div>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-[5px] border border-line px-4 text-sm font-bold text-ink hover:bg-paper-muted"
                onClick={onClose}
              >
                <X size={15} aria-hidden="true" />
                取消
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  disabled={!draft || loading}
                  className="inline-flex h-9 items-center gap-2 rounded-[5px] bg-vermilion px-4 text-sm font-bold text-[var(--accent-contrast)] disabled:opacity-50"
                  onClick={apply}
                >
                  <Settings size={15} aria-hidden="true" />
                  应用
                </button>
              ) : null}
            </div>
          </footer>
        </section>
      </ConfigProvider>
    </div>
  );
}
