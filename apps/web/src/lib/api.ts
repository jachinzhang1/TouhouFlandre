import createClient from "openapi-fetch";
import type { paths } from "../generated/api";
import type { MultiRoomFormat } from "@touhouflandre/shared";

// 默认同源（Next rewrites /api → Go 4000）；可被 NEXT_PUBLIC_API_BASE_URL 覆盖为直连。
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

type ApiResult<T> = { data?: T; error?: { error?: string }; response: Response };

const requestApi = async <T>(
  promise: Promise<ApiResult<T>>,
): Promise<T> => {
  const { data, error, response } = await promise;
  if (error) throw new Error(error.error ?? "请求失败。");
  if (!response.ok) throw new Error("请求失败。");
  // 204 无 body：data 为 undefined 属正常（ready/rematch/leave/close）
  return data as T;
};

/** 游客令牌请求头（08 §5.1：Authorization: Bearer guest:{token}）。 */
export const guestAuthHeader = (token: string) => ({
  Authorization: `Bearer guest:${token}`,
});

/** WS 地址推导（08 §10.1）：直连模式由 NEXT_PUBLIC_API_BASE_URL http→ws；否则同源。
 *  实测：Chromium 在页面加载期间对 localhost（→ ::1）的 WS 握手会延迟数十秒，
 *  127.0.0.1（IPv4）瞬时完成——WS 地址统一归一化为 IPv4。 */
export function roomWsUrl(roomId: string): string {
  let base = API_BASE_URL;
  if (base) {
    base = base.replace("//localhost:", "//127.0.0.1:");
    return base.replace(/^http/, "ws") + `/api/rooms/${roomId}/ws`;
  }
  return `${window.location.origin}/api/rooms/${roomId}/ws`;
}

export const api = {
  catalog: (signal?: AbortSignal) =>
    requestApi(client.GET("/api/catalog", { signal })),
  createPuzzle: (mode: "daily" | "random") =>
    requestApi(
      client.POST("/api/puzzles/{mode}", { params: { path: { mode } } }),
    ),
  submitGuess: async (sessionId: string, guessId: string) => {
    const { session } = await requestApi(
      client.POST("/api/sessions/{sessionId}/guess", {
        params: { path: { sessionId } },
        body: { guessId },
      }),
    );
    return session;
  },
  getSession: async (sessionId: string) => {
    const { session } = await requestApi(
      client.GET("/api/sessions/{sessionId}", {
        params: { path: { sessionId } },
      }),
    );
    return session;
  },

  // ---- 多人房间（08 §7.1） ----
  createRoom: (body: { format: MultiRoomFormat; displayName?: string }) =>
    requestApi(client.POST("/api/rooms", { body })),
  roomInfo: (roomCode: string) =>
    requestApi(
      client.GET("/api/rooms/{roomCode}", { params: { path: { roomCode } } }),
    ),
  joinRoom: (roomCode: string, body: { displayName?: string }) =>
    requestApi(
      client.POST("/api/rooms/{roomCode}/join", {
        params: { path: { roomCode } },
        body,
      }),
    ),
  roomSnapshot: (roomId: string, token: string, after = 0) =>
    requestApi(
      client.GET("/api/rooms/{roomId}/snapshot", {
        params: { path: { roomId }, query: { after } },
        headers: guestAuthHeader(token),
      }),
    ),
  setReady: (roomId: string, token: string) =>
    requestApi(
      client.POST("/api/rooms/{roomId}/ready", {
        params: { path: { roomId } },
        headers: guestAuthHeader(token),
      }),
    ),
  rematch: (roomId: string, token: string) =>
    requestApi(
      client.POST("/api/rooms/{roomId}/rematch", {
        params: { path: { roomId } },
        headers: guestAuthHeader(token),
      }),
    ),
  leaveRoom: (roomId: string, token: string) =>
    requestApi(
      client.POST("/api/rooms/{roomId}/leave", {
        params: { path: { roomId } },
        headers: guestAuthHeader(token),
      }),
    ),
  closeRoom: (roomId: string, token: string) =>
    requestApi(
      client.DELETE("/api/rooms/{roomId}", {
        params: { path: { roomId } },
        headers: guestAuthHeader(token),
      }),
    ),
  submitMultiGuess: (
    roomId: string,
    token: string,
    roundIndex: number,
    guessId: string,
    idempotencyKey: string,
  ) =>
    requestApi(
      client.POST("/api/rooms/{roomId}/rounds/{roundIndex}/guess", {
        params: { path: { roomId, roundIndex } },
        body: { guessId, idempotencyKey },
        headers: guestAuthHeader(token),
      }),
    ),
};
