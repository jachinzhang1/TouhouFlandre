const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export const requestJson = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败。");
  }
  return payload as T;
};
