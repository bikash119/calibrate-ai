import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { apiFetch } from "../api/client";
import {
  CalibrationExamplesResponseSchema,
  type CalibrationExamplesResponse,
} from "../schemas";

const VoidSchema = z.unknown();

export function useCalibrationExamples(
  projectId: number | undefined,
  criterionId: number | undefined,
) {
  return useQuery<CalibrationExamplesResponse>({
    queryKey: ["calibrationExamples", projectId, criterionId],
    queryFn: () =>
      apiFetch(
        `/projects/${projectId}/criteria/${criterionId}/calibration-examples`,
        CalibrationExamplesResponseSchema,
      ),
    enabled: projectId !== undefined && criterionId !== undefined,
  });
}

export function useGenerateCalibrationExamples(projectId: number, criterionId: number) {
  const qc = useQueryClient();
  return useMutation<CalibrationExamplesResponse, Error, number>({
    // Argument: max_examples
    mutationFn: (max_examples) =>
      apiFetch(
        `/projects/${projectId}/criteria/${criterionId}/calibration-examples/generate`,
        CalibrationExamplesResponseSchema,
        {
          method: "POST",
          body: JSON.stringify({ max_examples }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calibrationExamples", projectId, criterionId] });
    },
  });
}

export function useSetExampleActive(projectId: number, criterionId: number) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { exampleId: number; isActive: boolean }>({
    mutationFn: ({ exampleId, isActive }) =>
      apiFetch(`/calibration-examples/${exampleId}`, VoidSchema, {
        method: "PATCH",
        body: JSON.stringify({ is_active: isActive }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calibrationExamples", projectId, criterionId] });
    },
  });
}
