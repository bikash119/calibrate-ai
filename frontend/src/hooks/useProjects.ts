import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api/client";
import {
  ProjectDetailResponseSchema,
  ProjectsListResponseSchema,
  type ProjectCreateRequest,
  type ProjectDetailResponse,
  type ProjectsListResponse,
} from "../schemas";

export function useProjects(filters?: { program_id?: number; state?: string }) {
  const params = new URLSearchParams();
  if (filters?.program_id !== undefined) params.set("program_id", String(filters.program_id));
  if (filters?.state) params.set("state", filters.state);
  const query = params.toString();
  return useQuery<ProjectsListResponse>({
    queryKey: ["projects", filters ?? {}],
    queryFn: () =>
      apiFetch(`/projects${query ? `?${query}` : ""}`, ProjectsListResponseSchema),
  });
}

export function useProject(projectId: number | undefined) {
  return useQuery<ProjectDetailResponse>({
    queryKey: ["project", projectId],
    queryFn: () =>
      apiFetch(`/projects/${projectId}`, ProjectDetailResponseSchema),
    enabled: projectId !== undefined,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<ProjectDetailResponse, Error, ProjectCreateRequest>({
    mutationFn: (body) =>
      apiFetch("/projects", ProjectDetailResponseSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

interface UpdateProjectBody {
  name?: string;
  description?: string | null;
  language?: string | null;
}

export function useUpdateProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation<ProjectDetailResponse, Error, UpdateProjectBody>({
    mutationFn: (body) =>
      apiFetch(`/projects/${projectId}`, ProjectDetailResponseSchema, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useCloneProject(projectId: number) {
  const qc = useQueryClient();
  return useMutation<ProjectDetailResponse, Error, string>({
    // Argument: name for the new clone.
    mutationFn: (name) =>
      apiFetch(`/projects/${projectId}/clone`, ProjectDetailResponseSchema, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCreateDemoProject() {
  const qc = useQueryClient();
  return useMutation<ProjectDetailResponse, Error, void>({
    mutationFn: () =>
      apiFetch("/demo/project", ProjectDetailResponseSchema, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
