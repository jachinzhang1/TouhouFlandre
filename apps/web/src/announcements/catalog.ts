import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Announcement,
  AnnouncementReadResult,
  AnnouncementSummary,
} from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_IMAGE_TYPES = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

export function resolveAnnouncementsDirectory(): string {
  const configured = process.env.ANNOUNCEMENTS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(findWorkspaceRoot(process.cwd()), "content", "announcements");
}

export async function readAnnouncements(): Promise<AnnouncementReadResult> {
  return readAnnouncementsFromDirectory(resolveAnnouncementsDirectory());
}

export async function readAnnouncementsFromDirectory(
  directory: string,
): Promise<AnnouncementReadResult> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { announcements: [], warnings: [] };
    }
    throw error;
  }

  const warnings: AnnouncementReadResult["warnings"] = [];
  const announcements: Announcement[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(directory, entry.name);
    try {
      announcements.push(parseAnnouncement(entry.name, await readFile(filePath, "utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "公告文件无法解析。";
      warnings.push({ fileName: entry.name, message });
      console.warn(`announcement skipped: ${entry.name}: ${message}`);
    }
  }

  announcements.sort(compareAnnouncements);
  return { announcements, warnings };
}

export function parseAnnouncement(fileName: string, raw: string): Announcement {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("缺少 frontmatter。");
  }

  const meta = parseFrontmatter(match[1] ?? "");
  const title = meta.get("title")?.trim();
  const date = meta.get("date")?.trim();
  const pinned = meta.get("pinned")?.trim();

  if (!title) throw new Error("缺少 title。");
  if (!date || !DATE_RE.test(date)) {
    throw new Error("date 必须使用 yyyy-mm-dd。");
  }
  if (pinned !== "true" && pinned !== "false") {
    throw new Error("pinned 必须是 true 或 false。");
  }

  return {
    id: announcementId(fileName, raw),
    title,
    date,
    pinned: pinned === "true",
    body: raw.slice(match[0].length).trim(),
    fileName,
  };
}

export function toAnnouncementSummary(
  announcement: Announcement,
): AnnouncementSummary {
  const { body: _body, ...summary } = announcement;
  return summary;
}

export function resolveAnnouncementAsset(
  segments: string[],
  directory = resolveAnnouncementsDirectory(),
): { path: string; contentType: string } | null {
  if (!segments.length || segments.some((segment) => !segment || segment.includes("\0"))) {
    return null;
  }

  const assetsRoot = path.resolve(directory, "assets");
  const assetPath = path.resolve(assetsRoot, ...segments);
  if (!isInsideDirectory(assetsRoot, assetPath)) return null;

  const contentType = SAFE_IMAGE_TYPES.get(path.extname(assetPath).toLowerCase());
  if (!contentType) return null;
  return { path: assetPath, contentType };
}

function parseFrontmatter(source: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      throw new Error(`frontmatter 行格式错误：${trimmed}`);
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values.set(key, value);
  }
  return values;
}

function announcementId(fileName: string, raw: string): string {
  return createHash("sha256")
    .update(fileName)
    .update("\0")
    .update(raw)
    .digest("hex")
    .slice(0, 20);
}

function compareAnnouncements(a: Announcement, b: Announcement): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return a.fileName.localeCompare(b.fileName);
}

function findWorkspaceRoot(start: string): string {
  let current = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start, "../..");
}

function isInsideDirectory(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
