/**
 * Zod schemas mirroring the backend's Pydantic models in `api/schemas.py`.
 *
 * Conventions:
 *   - Schema names match the Pydantic class names exactly.
 *   - Types are derived via `z.infer<typeof Schema>` — never duplicated as interfaces.
 *   - Counts/metrics on *Item shapes are server-derived; the client never recomputes them.
 *   - Score scales are per-criterion (`scale_min`/`scale_max`); never assume 1-3 / 1-5.
 */

import { z } from "zod";

// ============================================================
// Auth
// ============================================================

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export const LoginResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  user_id: z.number(),
  username: z.string(),
  role: z.string(),
  display_name: z.string().nullable(),
});
export const UserMeResponseSchema = z.object({
  id: z.number(),
  username: z.string(),
  role: z.string(),
  display_name: z.string().nullable(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export type UserMeResponse = z.infer<typeof UserMeResponseSchema>;

// ============================================================
// Programs
// ============================================================

export const ProgramItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  project_count: z.number(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export const ProgramsListResponseSchema = z.object({
  programs: z.array(ProgramItemSchema),
});
export const ProgramCreateRequestSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
});
export const ProgramUpdateRequestSchema = ProgramCreateRequestSchema;
export type ProgramItem = z.infer<typeof ProgramItemSchema>;
export type ProgramsListResponse = z.infer<typeof ProgramsListResponseSchema>;
export type ProgramCreateRequest = z.infer<typeof ProgramCreateRequestSchema>;

// ============================================================
// Projects
// ============================================================

export const ProjectStateSchema = z.enum([
  "setup",
  "baseline_computed",
  "iterating",
  "test_run_complete",
  "locked",
  "abandoned",
  "archived",
]);

export const ProjectItemSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  program_name: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  state: ProjectStateSchema,
  application_count: z.number(),
  iteration_count: z.number(),
  latest_dev_qwk: z.number().nullable(),
  hh_baseline_qwk: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export const ProjectsListResponseSchema = z.object({
  projects: z.array(ProjectItemSchema),
});
export const ProjectDetailResponseSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  program_name: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  state: ProjectStateSchema,
  random_seed: z.number(),
  cloned_from_id: z.number().nullable(),
  application_count: z.number(),
  iteration_count: z.number(),
  has_locked_prompt: z.boolean(),
  created_by: z.number().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export const ProjectCreateRequestSchema = z.object({
  program_id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
});
export const ProjectCloneRequestSchema = z.object({ name: z.string() });
export const ProjectUpdateRequestSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
});
export const ProjectTransitionRequestSchema = z.object({
  new_state: ProjectStateSchema,
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type ProjectItem = z.infer<typeof ProjectItemSchema>;
export type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;
export type ProjectCreateRequest = z.infer<typeof ProjectCreateRequestSchema>;

// ============================================================
// Dashboard
// ============================================================

export const DashboardStatsResponseSchema = z.object({
  projects_by_state: z.record(z.string(), z.number()),
  programs_count: z.number(),
  locked_prompts_count: z.number(),
});
export type DashboardStatsResponse = z.infer<typeof DashboardStatsResponseSchema>;

// ============================================================
// Rubric (criteria)
// ============================================================

export const CriterionItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  scale_min: z.number(),
  scale_max: z.number(),
  anchor_descriptions: z.record(z.string(), z.string()),
  feeding_question_keys: z.array(z.string()),
  weighted_question_keys: z.array(z.string()),
  sort_order: z.number(),
});
export const RubricResponseSchema = z.object({
  project_id: z.number(),
  criteria: z.array(CriterionItemSchema),
});
export const CriterionInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  scale_min: z.number(),
  scale_max: z.number(),
  anchor_descriptions: z.record(z.string(), z.string()),
  feeding_question_keys: z.array(z.string()).default([]),
  weighted_question_keys: z.array(z.string()).default([]),
  sort_order: z.number().default(0),
});
export const RubricSaveRequestSchema = z.object({
  criteria: z.array(CriterionInputSchema),
});
export type CriterionItem = z.infer<typeof CriterionItemSchema>;
export type RubricResponse = z.infer<typeof RubricResponseSchema>;
export type CriterionInput = z.infer<typeof CriterionInputSchema>;
export type RubricSaveRequest = z.infer<typeof RubricSaveRequestSchema>;

// ============================================================
// Dataset: questions, applications, human scores
// ============================================================

export const QuestionTypeSchema = z.enum(["question", "demographic", "metadata"]);
export const QuestionItemSchema = z.object({
  id: z.number(),
  key: z.string(),
  text: z.string(),
  type: QuestionTypeSchema,
  sort_order: z.number(),
});
export const QuestionsResponseSchema = z.object({
  project_id: z.number(),
  questions: z.array(QuestionItemSchema),
});
export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type QuestionItem = z.infer<typeof QuestionItemSchema>;
export type QuestionsResponse = z.infer<typeof QuestionsResponseSchema>;

// --- Dataset import wizard ---------------------------------------- //

export const ColumnRoleSchema = z.enum([
  "id",
  "question",
  "demographic",
  "metadata",
  "exclude",
]);
export const ImportSheetInfoSchema = z.object({
  name: z.string(),
  rows: z.number(),
  columns: z.number(),
});
export const ImportPreviewSheetSchema = z.object({
  name: z.string(),
  total_rows: z.number(),
  rows: z.array(z.array(z.string().nullable())),
});
export const ImportPreviewResponseSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  sheets: z.array(ImportSheetInfoSchema),
  suggested_sheet: z.string(),
  preview: ImportPreviewSheetSchema,
});
export const ColumnMappingSchema = z.object({
  column_index: z.number(),
  role: ColumnRoleSchema,
});
export const ImportRequestSchema = z.object({
  sheet_name: z.string().nullable().optional(),
  question_row_index: z.number(),
  data_start_row_index: z.number(),
  column_mappings: z.array(ColumnMappingSchema),
});
export const ImportResponseSchema = z.object({
  questions_created: z.number(),
  applications_created: z.number(),
});
export type ColumnRole = z.infer<typeof ColumnRoleSchema>;
export type ImportSheetInfo = z.infer<typeof ImportSheetInfoSchema>;
export type ImportPreviewSheet = z.infer<typeof ImportPreviewSheetSchema>;
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type ImportRequest = z.infer<typeof ImportRequestSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;

export const ApplicationItemSchema = z.object({
  id: z.number(),
  external_id: z.string(),
  has_human_scores: z.boolean(),
  created_at: z.string().nullable(),
});
export const ApplicationsResponseSchema = z.object({
  project_id: z.number(),
  applications: z.array(ApplicationItemSchema),
});
export const ApplicationDetailSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  external_id: z.string(),
  answers: z.record(z.string(), z.string()),
  metadata: z.record(z.string(), z.string()).nullable(),
  created_at: z.string().nullable(),
});
export type ApplicationItem = z.infer<typeof ApplicationItemSchema>;
export type ApplicationsResponse = z.infer<typeof ApplicationsResponseSchema>;
export type ApplicationDetail = z.infer<typeof ApplicationDetailSchema>;

export const HumanScoreItemSchema = z.object({
  id: z.number(),
  application_id: z.number(),
  criterion_id: z.number(),
  evaluator_id: z.string(),
  score: z.number(),
  created_at: z.string().nullable(),
});
export const HumanScoresResponseSchema = z.object({
  project_id: z.number(),
  scores: z.array(HumanScoreItemSchema),
});
export const HumanScoreMedianItemSchema = z.object({
  application_id: z.number(),
  criterion_id: z.number(),
  median: z.number(),
  n: z.number(),
  individual_scores: z.array(z.number()),
});
export type HumanScoreItem = z.infer<typeof HumanScoreItemSchema>;
export type HumanScoresResponse = z.infer<typeof HumanScoresResponseSchema>;
export type HumanScoreMedianItem = z.infer<typeof HumanScoreMedianItemSchema>;

// ============================================================
// Splits
// ============================================================

export const SplitCountsResponseSchema = z.object({
  project_id: z.number(),
  counts: z.record(z.string(), z.number()),
  test_consumed: z.boolean(),
});
export type SplitCountsResponse = z.infer<typeof SplitCountsResponseSchema>;

// ============================================================
// Iterations
// ============================================================

export const CriterionPromptItemSchema = z.object({
  criterion_id: z.number(),
  criterion_name: z.string(),
  system_prompt: z.string(),
});
export const CriterionPromptInputSchema = z.object({
  criterion_id: z.number(),
  system_prompt: z.string(),
});
export const IterationCriterionMetricSchema = z.object({
  criterion_id: z.number(),
  criterion_name: z.string(),
  qwk: z.number().nullable(),
  qwk_ci_low: z.number().nullable(),
  qwk_ci_high: z.number().nullable(),
  n: z.number().nullable(),
});
export const IterationItemSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  version: z.number(),
  note: z.string().nullable(),
  dev_metrics: z.array(IterationCriterionMetricSchema),
  validation_metrics: z.array(IterationCriterionMetricSchema),
  overall_dev_qwk: z.number().nullable(),
  overall_validation_qwk: z.number().nullable(),
  created_at: z.string().nullable(),
});
export const IterationDetailResponseSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  version: z.number(),
  note: z.string().nullable(),
  prompts: z.array(CriterionPromptItemSchema),
  dev_metrics: z.array(IterationCriterionMetricSchema),
  validation_metrics: z.array(IterationCriterionMetricSchema),
  created_at: z.string().nullable(),
});
export const IterationsListResponseSchema = z.object({
  project_id: z.number(),
  iterations: z.array(IterationItemSchema),
});
export const IterationCreateRequestSchema = z.object({
  prompts: z.array(CriterionPromptInputSchema),
  note: z.string().nullable().optional(),
});

export const DiffLineItemSchema = z.object({
  type: z.enum(["add", "rm", "context"]),
  text: z.string(),
});
export const CriterionDiffSchema = z.object({
  criterion_id: z.number(),
  criterion_name: z.string(),
  lines: z.array(DiffLineItemSchema),
});
export const DiffResponseSchema = z.object({
  project_id: z.number(),
  from_version: z.number(),
  to_version: z.number(),
  per_criterion: z.array(CriterionDiffSchema),
});
export type CriterionPromptItem = z.infer<typeof CriterionPromptItemSchema>;
export type CriterionPromptInput = z.infer<typeof CriterionPromptInputSchema>;
export type IterationCriterionMetric = z.infer<typeof IterationCriterionMetricSchema>;
export type IterationItem = z.infer<typeof IterationItemSchema>;
export type IterationDetailResponse = z.infer<typeof IterationDetailResponseSchema>;
export type IterationsListResponse = z.infer<typeof IterationsListResponseSchema>;
export type DiffLineItem = z.infer<typeof DiffLineItemSchema>;
export type CriterionDiff = z.infer<typeof CriterionDiffSchema>;
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

// ============================================================
// Scoring jobs
// ============================================================

export const ScoringJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const SplitNameSchema = z.enum(["dev", "validation", "test", "production"]);

export const ScoringJobItemSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  iteration_id: z.number(),
  iteration_version: z.number(),
  split: SplitNameSchema,
  status: ScoringJobStatusSchema,
  progress_total: z.number(),
  progress_current: z.number(),
  provider: z.string(),
  model: z.string(),
  cost_estimate_usd: z.number().nullable(),
  cost_actual_usd: z.number().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string().nullable(),
});
export const ScoringJobsResponseSchema = z.object({
  project_id: z.number(),
  jobs: z.array(ScoringJobItemSchema),
});
export const ScoringJobStatusResponseSchema = z.object({
  id: z.number(),
  status: ScoringJobStatusSchema,
  progress_total: z.number(),
  progress_current: z.number(),
  error_message: z.string().nullable(),
  cost_actual_usd: z.number().nullable(),
});
export const ScoringJobCreateRequestSchema = z.object({
  split: SplitNameSchema,
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});
export const LlmScoreItemSchema = z.object({
  job_id: z.number(),
  application_id: z.number(),
  application_external_id: z.string(),
  criterion_id: z.number(),
  criterion_name: z.string(),
  score: z.number(),
  reasoning: z.string().nullable(),
  created_at: z.string().nullable(),
});
export const JobScoresResponseSchema = z.object({
  job_id: z.number(),
  scores: z.array(LlmScoreItemSchema),
});
export type SplitName = z.infer<typeof SplitNameSchema>;
export type ScoringJobStatus = z.infer<typeof ScoringJobStatusSchema>;
export type ScoringJobItem = z.infer<typeof ScoringJobItemSchema>;
export type ScoringJobsResponse = z.infer<typeof ScoringJobsResponseSchema>;
export type ScoringJobStatusResponse = z.infer<typeof ScoringJobStatusResponseSchema>;
export type LlmScoreItem = z.infer<typeof LlmScoreItemSchema>;
export type JobScoresResponse = z.infer<typeof JobScoresResponseSchema>;

// ============================================================
// Agreement metrics
// ============================================================

export const AgreementMetricItemSchema = z.object({
  project_id: z.number(),
  iteration_id: z.number().nullable(),
  split: z.string(),
  criterion_id: z.number().nullable(),
  criterion_name: z.string().nullable(),
  metric: z.string(),
  value: z.number().nullable(),
  ci_low: z.number().nullable(),
  ci_high: z.number().nullable(),
  n: z.number().nullable(),
  computed_at: z.string().nullable(),
});
export const BaselineResponseSchema = z.object({
  project_id: z.number(),
  per_criterion: z.array(AgreementMetricItemSchema),
  overall: z.array(AgreementMetricItemSchema),
  evaluator_count: z.number(),
});
export const IterationMetricsResponseSchema = z.object({
  project_id: z.number(),
  iteration_id: z.number(),
  split: z.string(),
  per_criterion: z.array(AgreementMetricItemSchema),
  overall: z.array(AgreementMetricItemSchema),
});
export type AgreementMetricItem = z.infer<typeof AgreementMetricItemSchema>;
export type BaselineResponse = z.infer<typeof BaselineResponseSchema>;
export type IterationMetricsResponse = z.infer<typeof IterationMetricsResponseSchema>;

// ============================================================
// Disagreements
// ============================================================

export const DisagreementFlagSchema = z.enum([
  "llm_correct",
  "human_correct",
  "ambiguous",
]);
export const DisagreementItemSchema = z.object({
  application_id: z.number(),
  application_external_id: z.string(),
  criterion_id: z.number(),
  criterion_name: z.string(),
  llm_score: z.number(),
  human_median: z.number(),
  human_individual_scores: z.array(z.number()),
  delta: z.number(),
  excerpt: z.string(),
  llm_reasoning: z.string().nullable(),
  flag: DisagreementFlagSchema.nullable(),
});
export const DisagreementsResponseSchema = z.object({
  project_id: z.number(),
  iteration_id: z.number(),
  disagreements: z.array(DisagreementItemSchema),
});
export const DisagreementFlagRequestSchema = z.object({
  application_id: z.number(),
  criterion_id: z.number(),
  flag: DisagreementFlagSchema,
});
export const DisagreementFlagCountsResponseSchema = z.object({
  project_id: z.number(),
  counts: z.record(z.string(), z.number()),
});
export type DisagreementFlag = z.infer<typeof DisagreementFlagSchema>;
export type DisagreementItem = z.infer<typeof DisagreementItemSchema>;
export type DisagreementsResponse = z.infer<typeof DisagreementsResponseSchema>;

// ============================================================
// Calibration examples
// ============================================================

export const CalibrationExampleSourceSchema = z.enum([
  "operator_flagged",
  "evaluator_consensus",
  "auto",
  "manual",
]);
export const CalibrationExampleItemSchema = z.object({
  id: z.number(),
  project_id: z.number(),
  criterion_id: z.number(),
  application_id: z.number(),
  application_external_id: z.string(),
  human_score: z.number(),
  synthesized_reasoning: z.string(),
  condensed_answers: z.array(z.record(z.string(), z.unknown())),
  source: CalibrationExampleSourceSchema,
  is_active: z.boolean(),
  sort_order: z.number(),
  created_at: z.string().nullable(),
});
export const CalibrationExamplesResponseSchema = z.object({
  project_id: z.number(),
  criterion_id: z.number(),
  examples: z.array(CalibrationExampleItemSchema),
});
export type CalibrationExampleItem = z.infer<typeof CalibrationExampleItemSchema>;
export type CalibrationExamplesResponse = z.infer<typeof CalibrationExamplesResponseSchema>;

// ============================================================
// Locked prompts
// ============================================================

export const LockedPromptItemSchema = z.object({
  id: z.number(),
  project_id: z.number().nullable(),
  iteration_id: z.number().nullable(),
  name: z.string(),
  prompt_hash: z.string(),
  provider: z.string(),
  model: z.string(),
  locked_by: z.number().nullable(),
  locked_at: z.string().nullable(),
});
export const LockedPromptsListResponseSchema = z.object({
  locked_prompts: z.array(LockedPromptItemSchema),
});
export const LockedPromptDetailResponseSchema = z.object({
  id: z.number(),
  project_id: z.number().nullable(),
  iteration_id: z.number().nullable(),
  name: z.string(),
  prompt_hash: z.string(),
  provider: z.string(),
  model: z.string(),
  rubric_snapshot: z.array(z.record(z.string(), z.unknown())),
  prompts_snapshot: z.record(z.string(), z.string()),
  examples_snapshot: z.array(z.record(z.string(), z.unknown())).nullable(),
  test_metrics: z.record(z.string(), z.unknown()),
  locked_by: z.number().nullable(),
  locked_at: z.string().nullable(),
});
export type LockedPromptItem = z.infer<typeof LockedPromptItemSchema>;
export type LockedPromptsListResponse = z.infer<typeof LockedPromptsListResponseSchema>;
export type LockedPromptDetailResponse = z.infer<typeof LockedPromptDetailResponseSchema>;

// ============================================================
// Audit log
// ============================================================

export const AuditEntryItemSchema = z.object({
  id: z.number(),
  user_id: z.number().nullable(),
  user_username: z.string().nullable(),
  entity_type: z.string(),
  entity_id: z.number().nullable(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string().nullable(),
});
export const AuditLogResponseSchema = z.object({
  entries: z.array(AuditEntryItemSchema),
});
export type AuditEntryItem = z.infer<typeof AuditEntryItemSchema>;
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
