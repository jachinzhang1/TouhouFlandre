"use client";

import { useEffect, useRef, useState, type ChangeEventHandler } from "react";
import { Download, Loader2, Save, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  normalizeQuestionScope,
  QUESTION_DIFFICULTY_LABELS,
  type FullCatalogSnapshot,
  type QuestionScopeConfig,
} from "@touhouflandre/shared";
import { useStickyState } from "../../hooks/useStickyState";
import { api } from "../../lib/api";
import {
  catalogFullToSnapshot,
  loadLocalQuestionScope,
  saveLocalQuestionScope,
} from "../../lib/questionScopeStorage";
import {
  Paper,
  PaperButton,
  PaperSegmentGroup,
  PaperSegmentSeparator,
} from "@/components/paper";
import {
  PageBackLink,
  PageHeader,
  PageHeaderAction,
} from "../layout/PageHeader";
import { QuestionScopeEditor } from "./QuestionScopeEditor";

type QuestionScopeExportFile = {
  kind: "touhouflandre.questionScope";
  exportedAt: string;
  questionScope: QuestionScopeConfig;
};

export function QuestionScopePage({
  backHref,
  roomCode,
}: {
  backHref: string;
  roomCode?: string;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FullCatalogSnapshot | null>(null);
  const [draft, setDraft] = useState<QuestionScopeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterHeadingStuck, setFilterHeadingStuck] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pageRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarStuck = useStickyState(toolbarRef);
  const readOnly = Boolean(roomCode);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError("");
      setNotice("");
      try {
        const loaded = catalogFullToSnapshot(await api.catalogFull());
        const initialConfig = roomCode
          ? ((await api.roomInfo(roomCode)).questionScope as
              QuestionScopeConfig | null | undefined)
          : null;
        const correction = roomCode
          ? normalizeQuestionScope(initialConfig ?? null, loaded)
          : loadLocalQuestionScope(loaded);
        if (disposed) return;
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
  }, [readOnly, revision, roomCode]);

  useEffect(() => {
    const page = pageRef.current;
    const toolbar = toolbarRef.current;
    if (!page || !toolbar) return;
    const update = () => {
      page.style.setProperty(
        "--question-scope-toolbar-height",
        `${toolbar.getBoundingClientRect().height}px`,
      );
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resizeObserver?.observe(toolbar);
    window.addEventListener("resize", update);
    update();
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
      page.style.removeProperty("--question-scope-toolbar-height");
    };
  }, []);

  const currentDifficulty = draft?.difficulty ?? "normal";
  const invalidScope = Boolean(
    !readOnly && draft && draft.selectedCharacterIds.length === 0,
  );
  const apply = () => {
    if (!snapshot || !draft || readOnly) return;
    const corrected = normalizeQuestionScope(draft, snapshot).config;
    saveLocalQuestionScope(corrected);
    router.push(backHref);
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
  const importConfig = async (file: File) => {
    if (!snapshot || readOnly) return;
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
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `题库设置导入失败：${caught.message}`
          : "题库设置导入失败。",
      );
    }
  };

  return (
    <section className="question-scope-page" aria-busy={loading} ref={pageRef}>
      <PageHeader
        description={
          readOnly
            ? "查看房主为当前多人房间配置的出题范围。"
            : "调整出题范围、反馈字段与每局限制。"
        }
        leftSlot={<PageBackLink href={backHref} />}
        rightSlot={
          !readOnly ? (
            <QuestionScopeTransferActions
              canExport={Boolean(draft && snapshot && !loading)}
              canImport={Boolean(snapshot && !loading)}
              onExport={exportConfig}
              onImport={importConfig}
            />
          ) : undefined
        }
        title={readOnly ? "房主题库设置" : "题库设置"}
      />

      <div
        className="question-scope-toolbar"
        data-stuck={toolbarStuck ? "true" : "false"}
        data-shadow={toolbarStuck && !filterHeadingStuck ? "true" : "false"}
        ref={toolbarRef}
      >
        <div className="question-scope-current-state">
          <span>当前难度</span>
          <strong className={invalidScope ? "is-invalid" : ""}>
            {invalidScope
              ? "无可用角色"
              : QUESTION_DIFFICULTY_LABELS[currentDifficulty]}
          </strong>
        </div>
        <PaperSegmentGroup
          className="question-scope-page-actions"
          label="题库设置操作"
        >
          <PaperButton folded={false} onClick={() => router.push(backHref)}>
            {readOnly ? "返回" : "取消"}
          </PaperButton>
          {!readOnly ? (
            <>
              <PaperSegmentSeparator />
              <PaperButton
                disabled={loading || Boolean(error) || !draft || !snapshot}
                filled
                onClick={apply}
                tone="theme"
              >
                <Save size={18} aria-hidden="true" />
                应用设置
              </PaperButton>
            </>
          ) : null}
        </PaperSegmentGroup>
      </div>

      {notice ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="question-scope-notice"
          pattern={false}
          folded={false}
          role="status"
          sticker={false}
          tone="success"
          unfoldOnHover={false}
        >
          {notice}
        </Paper>
      ) : null}
      {invalidScope ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="question-scope-notice"
          pattern={false}
          folded={false}
          role="alert"
          sticker={false}
          tone="danger"
          unfoldOnHover={false}
        >
          当前题库没有可用角色。应用时会自动恢复为 Normal 难度。
        </Paper>
      ) : null}

      {loading ? (
        <div className="question-scope-state" role="status">
          <Loader2 className="spin" size={20} aria-hidden="true" />
          <span>正在读取题库</span>
        </div>
      ) : error ? (
        <Paper
          animateOnMount={false}
          as="div"
          className="question-scope-state question-scope-state-error"
          foldSize={14}
          pattern={false}
          role="alert"
          unfoldOnHover={false}
          tone="danger"
        >
          <span>{error}</span>
          <PaperButton onClick={() => setRevision((value) => value + 1)}>
            重新加载
          </PaperButton>
        </Paper>
      ) : snapshot && draft ? (
        <QuestionScopeEditor
          draft={draft}
          onFilterStickyChange={setFilterHeadingStuck}
          snapshot={snapshot}
          readOnly={readOnly}
          onChange={setDraft}
        />
      ) : null}
    </section>
  );
}

function QuestionScopeTransferActions({
  canExport,
  canImport,
  onExport,
  onImport,
}: {
  canExport: boolean;
  canImport: boolean;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImport: ChangeEventHandler<HTMLInputElement> = (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void onImport(file).finally(() => {
      input.value = "";
    });
  };

  return (
    <div className="question-scope-transfer-actions">
      <input
        ref={importInputRef}
        accept="application/json,.json"
        className="sr-only"
        onChange={handleImport}
        type="file"
      />
      <PageHeaderAction
        ariaLabel="导出"
        disabled={!canExport}
        onClick={onExport}
      >
        <Upload size={18} aria-hidden="true" />
        <span className="question-scope-action-label">导出</span>
      </PageHeaderAction>
      <PageHeaderAction
        ariaLabel="导入"
        disabled={!canImport}
        onClick={() => importInputRef.current?.click()}
      >
        <Download size={18} aria-hidden="true" />
        <span className="question-scope-action-label">导入</span>
      </PageHeaderAction>
    </div>
  );
}
