import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAnnouncement,
  readAnnouncementsFromDirectory,
  resolveAnnouncementAsset,
} from "./catalog";

let tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "touhou-announcements-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("announcement catalog", () => {
  it("parses frontmatter and sorts pinned announcements first", async () => {
    const dir = await makeTempDir();
    await writeFile(
      path.join(dir, "old-pinned.md"),
      frontmatter("置顶旧公告", "2026-08-01", true, "old pinned"),
    );
    await writeFile(
      path.join(dir, "new-normal.md"),
      frontmatter("普通新公告", "2026-08-08", false, "new normal"),
    );
    await writeFile(
      path.join(dir, "new-pinned.md"),
      frontmatter("置顶新公告", "2026-08-07", true, "new pinned"),
    );

    const result = await readAnnouncementsFromDirectory(dir);

    expect(result.warnings).toEqual([]);
    expect(result.announcements.map((item) => item.title)).toEqual([
      "置顶新公告",
      "置顶旧公告",
      "普通新公告",
    ]);
  });

  it("changes the announcement id when file content changes", () => {
    const before = parseAnnouncement(
      "notice.md",
      frontmatter("公告", "2026-08-08", false, "第一版"),
    );
    const after = parseAnnouncement(
      "notice.md",
      frontmatter("公告", "2026-08-08", false, "第二版"),
    );

    expect(before.id).not.toBe(after.id);
  });

  it("skips invalid markdown files and returns warnings", async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, "invalid.md"), "no frontmatter");
    await writeFile(
      path.join(dir, "bad-date.md"),
      frontmatter("日期错误", "08-08-2026", false, "bad"),
    );
    await writeFile(
      path.join(dir, "valid.md"),
      frontmatter("有效公告", "2026-08-08", false, "ok"),
    );

    const result = await readAnnouncementsFromDirectory(dir);

    expect(result.announcements.map((item) => item.title)).toEqual(["有效公告"]);
    expect(result.warnings).toHaveLength(2);
  });

  it("returns an empty catalog when the directory does not exist", async () => {
    const result = await readAnnouncementsFromDirectory(
      path.join(tmpdir(), "missing-announcements-dir"),
    );

    expect(result).toEqual({ announcements: [], warnings: [] });
  });

  it("keeps announcement assets inside the assets directory", () => {
    const dir = path.join(tmpdir(), "announcements");

    expect(resolveAnnouncementAsset(["banner.png"], dir)).toEqual({
      path: path.join(dir, "assets", "banner.png"),
      contentType: "image/png",
    });
    expect(resolveAnnouncementAsset(["..", "secret.png"], dir)).toBeNull();
    expect(resolveAnnouncementAsset(["notice.md"], dir)).toBeNull();
  });
});

function frontmatter(
  title: string,
  date: string,
  pinned: boolean,
  body: string,
) {
  return `---\ntitle: ${title}\ndate: ${date}\npinned: ${pinned}\n---\n\n${body}\n`;
}
