// 题库文本归一化：seed 写入 search_text 时使用；data 校验保证与 Go seed 一致。
export const normalizeSearchText = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\s_.・·-]/g, "");
