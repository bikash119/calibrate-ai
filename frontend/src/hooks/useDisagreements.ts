import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  DisagreementFlagCountsResponseSchema,
  DisagreementsResponseSchema,
  type DisagreementFlag,
  type DisagreementsResponse,
} from "../schemas";
import { z } from "zod";

const VoidSchema = z.unknown();

export type ComparisonKind = "disagreement" | "agreement" | "all";

export function useDisagreements(
  projectId: number | undefined,
  iterationId: number | undefined,
  split: string,
  options: { kind?: ComparisonKind } = {},
) {
  const kind = options.kind ?? "disagreement";
  return useQuery<DisagreementsResponse>({
    queryKey: ["disagreements", projectId, iterationId, split, kind],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/iterations/${iterationId}/disagreements?split=${split}&kind=${kind}`,
        DisagreementsResponseSchema,
      ),
    enabled: projectId !== undefined && iterationId !== undefined,
  });
}

export function useDisagreementCounts(projectId: number | undefined) {
  return useQuery({
    queryKey: ["disagreementCounts", projectId],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/disagreements/counts`,
        DisagreementFlagCountsResponseSchema,
      ),
    enabled: projectId !== undefined,
  });
}

interface FlagBody {
  application_id: number;
  criterion_id: number;
  flag: DisagreementFlag;
}

export function useFlagDisagreement(projectId: number) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, FlagBody>({
    mutationFn: (body) =>
      apiFetch(`/projects/${projectId}/disagreements/flag`, VoidSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["disagreements", projectId] });
      qc.invalidateQueries({ queryKey: ["disagreementCounts", projectId] });
    },
  });
}
