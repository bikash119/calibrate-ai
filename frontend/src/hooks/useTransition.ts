import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  ProjectDetailResponseSchema,
  type ProjectDetailResponse,
  type ProjectState,
} from "../schemas";

export function useTransitionProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation<ProjectDetailResponse, Error, ProjectState>({
    mutationFn: (new_state) =>
      apiFetch(`/projects/${projectId}/transition`, ProjectDetailResponseSchema, {
        method: "POST",
        body: JSON.stringify({ new_state }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
