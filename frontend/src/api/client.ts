/**
 * Minimal authenticated fetch wrapper.
 *
 * Domain hooks live in `hooks/`. This file only exposes `apiFetch` and `ApiError`.
 */

import { z } from "zod";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("scoring_ai_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticated fetch with Zod response validation.
 *
 * Pass `null` as the schema to skip validation (e.g. 204 No Content).
 */
export async function apiFetch<T>(
  path: string,
  schema: z.ZodSchema<T> | null,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new ApiError(res.status, body.detail || `Request failed (${res.status})`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json();
  return schema ? schema.parse(data) : (data as T);
}
