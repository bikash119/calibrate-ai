import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import { DashboardStatsResponseSchema, type DashboardStatsResponse } from "../schemas";

export function useDashboardStats() {
  return useQuery<DashboardStatsResponse>({
    queryKey: ["dashboard", "stats"],
    queryFn: () => apiFetch("/dashboard/stats", DashboardStatsResponseSchema),
  });
}
