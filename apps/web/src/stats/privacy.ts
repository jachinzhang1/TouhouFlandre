const PRIVATE_KEYS = new Set([
  "memberId",
  "memberSlot",
  "displayName",
  "roomId",
  "roomCode",
  "guestToken",
  "token",
  "encounterId",
  "seat",
]);

export function assertStatsPrivacy(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertStatsPrivacy);
    return;
  }
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (PRIVATE_KEYS.has(key)) {
      throw new Error(`统计数据包含禁止字段：${key}`);
    }
    assertStatsPrivacy(nested);
  }
}
