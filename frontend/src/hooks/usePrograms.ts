import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/client";
import {
  ProgramItemSchema,
  ProgramsListResponseSchema,
  type ProgramCreateRequest,
  type ProgramItem,
  type ProgramsListResponse,
} from "../schemas";

const VoidSchema = z.unknown();

export function usePrograms() {
  return useQuery<ProgramsListResponse>({
    queryKey: ["programs"],
    queryFn: () => apiFetch("/programs", ProgramsListResponseSchema),
  });
}

export function useCreateProgram() {
  const qc = useQueryClient();
  return useMutation<ProgramItem, Error, ProgramCreateRequest>({
    mutationFn: (body) =>
      apiFetch("/programs", ProgramItemSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

interface UpdateBody {
  id: number;
  name: string;
  description: string | null;
}

export function useUpdateProgram() {
  const qc = useQueryClient();
  return useMutation<ProgramItem, Error, UpdateBody>({
    mutationFn: ({ id, name, description }) =>
      apiFetch(`/programs/${id}`, ProgramItemSchema, {
        method: "PUT",
        body: JSON.stringify({ name, description }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useDeleteProgram() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/programs/${id}`, VoidSchema, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["programs"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
