import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./query";

describe("scoped search query parser", () => {
  it.each([
    ["  mm  ", { kind: "plain", text: "mm" }],
    [
      "  mm  @  lyz  ",
      { kind: "scoped", characterText: "mm", workText: "lyz" },
    ],
    ["mm@", { kind: "scoped", characterText: "mm", workText: "" }],
    ["@10", { kind: "scoped", characterText: "", workText: "10" }],
    ["@", { kind: "scoped", characterText: "", workText: "" }],
    [
      "mm@lyz@ignored",
      { kind: "scoped", characterText: "mm", workText: "lyz@ignored" },
    ],
    ["mm＠lyz", { kind: "plain", text: "mm＠lyz" }],
  ])("parses %j", (input, expected) => {
    expect(parseSearchQuery(input)).toEqual(expected);
  });
});
