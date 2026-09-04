import { describe, expect, it } from "vitest";
import { resolveWorkIdsParam } from "./useSearchPageState";

const workIds = ["th06", "th07", "th08"];

describe("resolveWorkIdsParam", () => {
  it("does not filter when no tags are selected", () => {
    expect(resolveWorkIdsParam(workIds, [], "whitelist")).toBeUndefined();
    expect(resolveWorkIdsParam(workIds, [], "blacklist")).toBeUndefined();
  });

  it("uses selected tags as a whitelist", () => {
    expect(resolveWorkIdsParam(workIds, ["th06", "th08"], "whitelist")).toBe(
      "th06,th08",
    );
  });

  it("uses the complement of selected tags as a blacklist", () => {
    expect(resolveWorkIdsParam(workIds, ["th07"], "blacklist")).toBe(
      "th06,th08",
    );
    expect(resolveWorkIdsParam(workIds, workIds, "blacklist")).toBe("");
  });
});
