export type ParsedSearchQuery =
  | { kind: "plain"; text: string }
  | { kind: "scoped"; characterText: string; workText: string };

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const separator = input.indexOf("@");
  if (separator < 0) {
    return { kind: "plain", text: input.trim() };
  }
  return {
    kind: "scoped",
    characterText: input.slice(0, separator).trim(),
    workText: input.slice(separator + 1).trim(),
  };
}
