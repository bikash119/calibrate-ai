"""Pydantic request/response schemas for the calibration API.

Conventions:
- *CreateRequest, *UpdateRequest for POST/PUT bodies
- *Item for list elements
- *Response for top-level response bodies
- Timestamps are str (ISO 8601), never datetime
- Derived/computed fields (counts, medians, latest metrics) are documented inline
"""

from pydantic import BaseModel


# ============================================================
# Auth
# ============================================================


class LoginRequest(BaseModel):
    """POST /api/auth/login."""
    username: str
    password: str


class LoginResponse(BaseModel):
    """POST /api/auth/login."""
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str
    display_name: str | None = None


class UserMeResponse(BaseModel):
    """GET /api/auth/me."""
    id: int
    username: str
    role: str
    display_name: str | None = None


# ============================================================
# Programs
# ============================================================


class ProgramCreateRequest(BaseModel):
    """POST /api/programs."""
    name: str
    description: str | None = None


class ProgramUpdateRequest(BaseModel):
    """PUT /api/programs/{id}."""
    name: str
    description: str | None = None


class ProgramItem(BaseModel):
    """Single program in a list. project_count is derived."""
    id: int
    name: str
    description: str | None = None
    project_count: int            # derived
    created_at: str | None = None
    updated_at: str | None = None


class ProgramsListResponse(BaseModel):
    """GET /api/programs."""
    programs: list[ProgramItem]


# ============================================================
# Projects
# ============================================================


class ProjectCreateRequest(BaseModel):
    """POST /api/projects."""
    program_id: int
    name: str
    description: str | None = None
    language: str | None = None


class ProjectCloneRequest(BaseModel):
    """POST /api/projects/{id}/clone — copies rubric + dataset to a new project."""
    name: str


class ProjectUpdateRequest(BaseModel):
    """PATCH /api/projects/{id}."""
    name: str | None = None
    description: str | None = None
    language: str | None = None


class ProjectTransitionRequest(BaseModel):
    """POST /api/projects/{id}/transition."""
    new_state: str


class ProjectItem(BaseModel):
    """Single project in a list. Counts/metrics are server-computed, never stored."""
    id: int
    program_id: int
    program_name: str             # denormalized for display
    name: str
    description: str | None = None
    language: str | None = None
    state: str
    application_count: int        # derived: COUNT(applications) for this project
    iteration_count: int          # derived: COUNT(iterations) for this project
    latest_dev_qwk: float | None = None      # derived: latest iteration's dev-split overall QWK
    hh_baseline_qwk: float | None = None     # derived: project-overall H-H QWK if computed
    created_at: str | None = None
    updated_at: str | None = None


class ProjectDetailResponse(BaseModel):
    """GET /api/projects/{id}. Includes ownership and lineage."""
    id: int
    program_id: int
    program_name: str
    name: str
    description: str | None = None
    language: str | None = None
    state: str
    random_seed: int
    cloned_from_id: int | None = None
    application_count: int        # derived
    iteration_count: int          # derived
    has_locked_prompt: bool       # derived
    created_by: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProjectsListResponse(BaseModel):
    """GET /api/projects."""
    projects: list[ProjectItem]


class DashboardStatsResponse(BaseModel):
    """GET /api/dashboard/stats."""
    projects_by_state: dict[str, int]    # derived: COUNT(*) GROUP BY state
    programs_count: int                  # derived
    locked_prompts_count: int            # derived


# ============================================================
# Rubric (criteria)
# ============================================================


class CriterionInput(BaseModel):
    """A criterion in a rubric save request. ID omitted for new criteria."""
    name: str
    description: str
    scale_min: int
    scale_max: int
    anchor_descriptions: dict[str, str]                  # {"1": "...", "2": "..."}
    feeding_question_keys: list[str] = []                # references questions by their operator-defined `key`
    weighted_question_keys: list[str] = []
    sort_order: int = 0


class CriterionItem(BaseModel):
    """A criterion in a rubric response."""
    id: int
    name: str
    description: str
    scale_min: int
    scale_max: int
    anchor_descriptions: dict[str, str]
    feeding_question_keys: list[str]
    weighted_question_keys: list[str]
    sort_order: int


class RubricSaveRequest(BaseModel):
    """PUT /api/projects/{id}/rubric — atomic replacement."""
    criteria: list[CriterionInput]


class RubricResponse(BaseModel):
    """GET /api/projects/{id}/rubric."""
    project_id: int
    criteria: list[CriterionItem]


class RubricExtractTextRequest(BaseModel):
    """POST /api/projects/{id}/rubric/extract — text body path."""
    text: str


class RubricExtractResponse(BaseModel):
    """Either /extract endpoint returns this. The UI uses the returned
    `criteria` to seed its inline rubric editor, then the operator reviews
    and saves via PUT /rubric."""
    criteria: list[CriterionInput]


# ============================================================
# Dataset: questions, applications, human scores
# ============================================================


class QuestionInput(BaseModel):
    """A question in a dataset save request."""
    key: str                       # operator-defined identifier (e.g. 'q1', 'team')
    text: str
    type: str = "question"         # 'question' | 'demographic' | 'metadata'
    sort_order: int = 0


class QuestionItem(BaseModel):
    """A question in a response."""
    id: int
    key: str
    text: str
    type: str                      # 'question' | 'demographic' | 'metadata'
    sort_order: int


class QuestionsSaveRequest(BaseModel):
    """PUT /api/projects/{id}/questions — atomic replacement."""
    questions: list[QuestionInput]


class QuestionsResponse(BaseModel):
    """GET /api/projects/{id}/questions."""
    project_id: int
    questions: list[QuestionItem]


class ApplicationItem(BaseModel):
    """A single application in a list (no answers, for index views)."""
    id: int
    external_id: str
    has_human_scores: bool        # derived
    created_at: str | None = None


class ApplicationDetail(BaseModel):
    """GET /api/projects/{pid}/applications/{aid} — full record with answers."""
    id: int
    project_id: int
    external_id: str
    answers: dict[str, str]       # {question.key: answer text}
    metadata: dict[str, str] | None = None
    created_at: str | None = None


class ApplicationsResponse(BaseModel):
    """GET /api/projects/{id}/applications."""
    project_id: int
    applications: list[ApplicationItem]


# --- Dataset import wizard ----------------------------------------- #
# Flow: client uploads file → /dataset/parse returns preview → user
# picks the question row + tags columns → /dataset/import re-uploads file
# with mappings and atomically replaces questions + applications.

class ImportSheetInfo(BaseModel):
    """One sheet in an uploaded XLSX (CSV files emit a single synthetic sheet)."""
    name: str
    rows: int                      # excluding header detection — total rows in sheet
    columns: int


class ImportPreviewSheet(BaseModel):
    """The preview rows for the chosen (or default) sheet."""
    name: str
    total_rows: int
    rows: list[list[str | None]]   # first N rows, all cells stringified, null for empty


class ImportPreviewResponse(BaseModel):
    """POST /api/projects/{id}/dataset/parse."""
    format: str                    # 'csv' | 'xlsx'
    sheets: list[ImportSheetInfo]  # for CSV: single synthetic sheet
    suggested_sheet: str           # default for the picker
    preview: ImportPreviewSheet    # rows for the suggested sheet


class ColumnMapping(BaseModel):
    """One column → one role assignment."""
    column_index: int              # 0-based
    role: str                      # 'id' | 'question' | 'demographic' | 'metadata' | 'exclude'


class ImportRequest(BaseModel):
    """Mappings JSON sent alongside the file in POST /dataset/import."""
    sheet_name: str | None = None  # required for XLSX, ignored for CSV
    question_row_index: int        # 0-based row that holds question text
    data_start_row_index: int      # 0-based first data row (typically question_row_index + 1)
    column_mappings: list[ColumnMapping]


class ImportResponse(BaseModel):
    """POST /api/projects/{id}/dataset/import."""
    questions_created: int
    applications_created: int


class HumanScoreItem(BaseModel):
    """A single human score by one evaluator."""
    id: int
    application_id: int
    criterion_id: int
    evaluator_id: str
    score: int
    created_at: str | None = None


class HumanScoresResponse(BaseModel):
    """GET /api/projects/{id}/human-scores."""
    project_id: int
    scores: list[HumanScoreItem]


class HumanScoreMedianItem(BaseModel):
    """Server-derived median across evaluators for one (application, criterion)."""
    application_id: int
    criterion_id: int
    median: float                 # may be non-integer when n is even
    n: int                        # number of evaluators contributing
    individual_scores: list[int]  # the raw scores (sorted), for transparency


# ============================================================
# Splits
# ============================================================


class SplitCountsResponse(BaseModel):
    """GET /api/projects/{id}/splits."""
    project_id: int
    counts: dict[str, int]        # {'dev': 100, 'validation': 30, 'test': 30}
    test_consumed: bool           # derived: has any completed test-split scoring job


# ============================================================
# Iterations
# ============================================================


class CriterionPromptInput(BaseModel):
    """A per-criterion system prompt in an iteration create request."""
    criterion_id: int
    system_prompt: str


class CriterionPromptItem(BaseModel):
    """A per-criterion system prompt in a response. Includes criterion_name for display."""
    criterion_id: int
    criterion_name: str           # denormalized for display
    system_prompt: str


class IterationCreateRequest(BaseModel):
    """POST /api/projects/{id}/iterations — create a new prompt version."""
    prompts: list[CriterionPromptInput]
    note: str | None = None


class IterationCriterionMetric(BaseModel):
    """One criterion's QWK for one iteration on one split (for table display)."""
    criterion_id: int
    criterion_name: str           # denormalized for display
    qwk: float | None = None
    qwk_ci_low: float | None = None
    qwk_ci_high: float | None = None
    n: int | None = None


class IterationItem(BaseModel):
    """An iteration in a list. Metrics are derived from agreement_metrics."""
    id: int
    project_id: int
    version: int
    note: str | None = None
    dev_metrics: list[IterationCriterionMetric] = []      # derived
    validation_metrics: list[IterationCriterionMetric] = []  # derived
    overall_dev_qwk: float | None = None                  # derived
    overall_validation_qwk: float | None = None           # derived
    created_at: str | None = None


class IterationDetailResponse(BaseModel):
    """GET /api/projects/{pid}/iterations/{iid} — includes the prompts."""
    id: int
    project_id: int
    version: int
    note: str | None = None
    prompts: list[CriterionPromptItem]
    dev_metrics: list[IterationCriterionMetric] = []
    validation_metrics: list[IterationCriterionMetric] = []
    created_at: str | None = None


class IterationsListResponse(BaseModel):
    """GET /api/projects/{id}/iterations."""
    project_id: int
    iterations: list[IterationItem]


class DiffLineItem(BaseModel):
    """One line in a unified diff."""
    type: str                     # 'add' | 'rm' | 'context'
    text: str


class CriterionDiff(BaseModel):
    """Diff for one criterion's prompt between two iteration versions."""
    criterion_id: int
    criterion_name: str
    lines: list[DiffLineItem]


class DiffResponse(BaseModel):
    """GET /api/projects/{pid}/iterations/{from_v}/diff/{to_v}."""
    project_id: int
    from_version: int
    to_version: int
    per_criterion: list[CriterionDiff]


# ============================================================
# Scoring jobs (LLM batch / sequential / single runs)
# ============================================================


class ScoringJobCreateRequest(BaseModel):
    """POST /api/projects/{pid}/iterations/{iid}/score — kick off a scoring job."""
    split: str                    # 'dev' | 'validation' | 'test' | 'production'
    provider: str | None = None   # defaults to env LLM_PROVIDER
    model: str | None = None      # defaults to provider's default


class ScoringJobItem(BaseModel):
    """A scoring job in a list."""
    id: int
    project_id: int
    iteration_id: int
    iteration_version: int        # denormalized for display
    split: str
    status: str
    progress_total: int
    progress_current: int
    provider: str
    model: str
    cost_estimate_usd: float | None = None
    cost_actual_usd: float | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


class ScoringJobsResponse(BaseModel):
    """GET /api/projects/{id}/scoring-jobs."""
    project_id: int
    jobs: list[ScoringJobItem]


class ScoringJobStatusResponse(BaseModel):
    """GET /api/scoring-jobs/{id} — focused status payload for polling."""
    id: int
    status: str
    progress_total: int
    progress_current: int
    error_message: str | None = None
    cost_actual_usd: float | None = None


# ============================================================
# LLM scores
# ============================================================


class LlmScoreItem(BaseModel):
    """A single LLM score for (job, application, criterion)."""
    job_id: int
    application_id: int
    application_external_id: str  # denormalized for display
    criterion_id: int
    criterion_name: str           # denormalized for display
    score: int
    reasoning: str | None = None
    created_at: str | None = None


class JobScoresResponse(BaseModel):
    """GET /api/scoring-jobs/{id}/scores."""
    job_id: int
    scores: list[LlmScoreItem]


# ============================================================
# Agreement metrics (H-H baseline AND LLM-H — same generic shape)
# ============================================================


class AgreementMetricItem(BaseModel):
    """Generic agreement metric row.

    iteration_id NULL = H-H baseline; non-NULL = LLM-H for that iteration.
    criterion_id NULL = project-overall; non-NULL = per-criterion.
    """
    project_id: int
    iteration_id: int | None = None
    split: str                    # 'dev' | 'validation' | 'test' | 'all'
    criterion_id: int | None = None
    criterion_name: str | None = None    # denormalized when criterion_id is set
    metric: str                   # 'qwk' | 'exact' | 'within_1' | 'krippendorff' | 'spearman' | …
    value: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    n: int | None = None
    computed_at: str | None = None


class BaselineResponse(BaseModel):
    """GET /api/projects/{id}/baseline — H-H agreement metrics."""
    project_id: int
    per_criterion: list[AgreementMetricItem]   # one row per (criterion, metric) pair
    overall: list[AgreementMetricItem]         # project-overall metrics (criterion_id NULL)
    evaluator_count: int                       # derived


class IterationMetricsResponse(BaseModel):
    """GET /api/projects/{pid}/iterations/{iid}/metrics — LLM-H metrics for an iteration."""
    project_id: int
    iteration_id: int
    split: str
    per_criterion: list[AgreementMetricItem]
    overall: list[AgreementMetricItem]


# ============================================================
# Disagreement flags
# ============================================================


class DisagreementItem(BaseModel):
    """An LLM-H disagreement for triage during iteration."""
    application_id: int
    application_external_id: str
    criterion_id: int
    criterion_name: str
    llm_score: int
    human_median: float
    human_individual_scores: list[int]
    delta: float                  # llm_score - human_median
    excerpt: str                  # first feeding-question answer, truncated
    llm_reasoning: str | None = None
    flag: str | None = None       # 'llm_correct' | 'human_correct' | 'ambiguous' | None


class DisagreementsResponse(BaseModel):
    """GET /api/projects/{pid}/iterations/{iid}/disagreements."""
    project_id: int
    iteration_id: int
    disagreements: list[DisagreementItem]


class DisagreementFlagRequest(BaseModel):
    """POST /api/projects/{pid}/disagreements/flag."""
    application_id: int
    criterion_id: int
    flag: str                     # 'llm_correct' | 'human_correct' | 'ambiguous'


class DisagreementFlagCountsResponse(BaseModel):
    """GET /api/projects/{id}/disagreements/counts."""
    project_id: int
    counts: dict[str, int]        # {'llm_correct': 12, 'human_correct': 5, 'ambiguous': 3}


# ============================================================
# Calibration examples (few-shot)
# ============================================================


class CalibrationExampleItem(BaseModel):
    """A few-shot calibration example for one criterion."""
    id: int
    project_id: int
    criterion_id: int
    application_id: int
    application_external_id: str  # denormalized for display
    human_score: int
    synthesized_reasoning: str
    condensed_answers: list[dict] # JSON-decoded for client convenience
    source: str                   # 'operator_flagged' | 'evaluator_consensus' | 'auto' | 'manual'
    is_active: bool
    sort_order: int
    created_at: str | None = None


class CalibrationExamplesResponse(BaseModel):
    """GET /api/projects/{pid}/criteria/{cid}/calibration-examples."""
    project_id: int
    criterion_id: int
    examples: list[CalibrationExampleItem]


class CalibrationExampleGenerateRequest(BaseModel):
    """POST /api/projects/{pid}/criteria/{cid}/calibration-examples/generate."""
    max_examples: int = 3


class CalibrationExampleSetActiveRequest(BaseModel):
    """PATCH /api/calibration-examples/{id}."""
    is_active: bool


# ============================================================
# Locked prompts (immutable artifact)
# ============================================================


class LockProjectRequest(BaseModel):
    """POST /api/projects/{id}/lock — finalize after test-split run."""
    name: str                     # human-readable label for this locked artifact


class LockedPromptItem(BaseModel):
    """A locked prompt in a list."""
    id: int
    project_id: int | None = None         # may be NULL if project was deleted
    iteration_id: int | None = None
    name: str
    prompt_hash: str
    provider: str
    model: str
    locked_by: int | None = None
    locked_at: str | None = None


class LockedPromptDetailResponse(BaseModel):
    """GET /api/locked-prompts/{id} — includes the snapshots."""
    id: int
    project_id: int | None = None
    iteration_id: int | None = None
    name: str
    prompt_hash: str
    provider: str
    model: str
    rubric_snapshot: list[dict]    # criteria, JSON-decoded
    prompts_snapshot: dict         # {criterion_name: system_prompt}
    examples_snapshot: list[dict] | None = None
    test_metrics: dict             # {'llm_h_test': [...], 'hh_baseline': [...]}, JSON-decoded
    locked_by: int | None = None
    locked_at: str | None = None


class LockedPromptsListResponse(BaseModel):
    """GET /api/locked-prompts."""
    locked_prompts: list[LockedPromptItem]


# ============================================================
# Audit log
# ============================================================


class AuditEntryItem(BaseModel):
    """A single audit log entry."""
    id: int
    user_id: int | None = None
    user_username: str | None = None  # denormalized for display
    entity_type: str
    entity_id: int | None = None
    action: str
    details: dict | None = None       # JSON-decoded for client convenience
    created_at: str | None = None


class AuditLogResponse(BaseModel):
    """GET /api/audit?entity_type=…&entity_id=…  or  GET /api/audit/recent."""
    entries: list[AuditEntryItem]


# ============================================================
# Cost estimate
# ============================================================


class CostEstimateResponse(BaseModel):
    """GET /api/projects/{pid}/iterations/{iid}/cost-estimate?split=…."""
    project_id: int
    iteration_id: int
    split: str
    application_count: int
    criterion_count: int
    request_count: int            # apps × criteria
    provider: str
    model: str
    estimated_cost_usd: float
