import { describe, expect, it } from "vitest";
import { joinValues } from "./format";

describe("joinValues", () => {
  it("joins values with 、", () => {
    expect(joinValues(["人类", "魔法使"])).toBe("人类、魔法使");
  });

  it("returns empty string for empty array", () => {
    expect(joinValues([])).toBe("");
  });
});
