import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import { AuditLogResponseSchema, type AuditLogResponse } from "../schemas";

export function useAuditForEntity(
  entityType: string,
  entityId: number | undefined,
) {
  return useQuery<AuditLogResponse>({
    queryKey: ["audit", entityType, entityId],
    queryFn: () =>
      apiFetch(
        `/audit?entity_type=${entityType}&entity_id=${entityId}`,
        AuditLogResponseSchema,
      ),
    enabled: entityId !== undefined,
  });
}

export function useRecentAudit(limit: number = 100) {
  return useQuery<AuditLogResponse>({
    queryKey: ["audit", "recent", limit],
    queryFn: () => apiFetch(`/audit/recent?limit=${limit}`, AuditLogResponseSchema),
  });
}
