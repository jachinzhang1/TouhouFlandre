// 仅供题库数据校验使用；运行时模糊匹配统一由 Go API 执行。
export const normalizeSearchText = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\s_.・·-]/g, "");
