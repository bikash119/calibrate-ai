---
name: frontend
description: Frontend development patterns for Scoring AI — React components, design tokens, React Query hooks, Zod schemas, routing conventions. Use before writing any frontend code.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Frontend Development Skill

You are implementing frontend features for the Scoring AI platform — a React 19 + TypeScript + Vite application with a custom design system. Follow these patterns exactly. Do not invent new patterns.

## Technology Stack

- **React 19** with TypeScript 5.9
- **Vite 7** for build/dev
- **Tailwind CSS 4** for utility classes
- **CSS custom properties** for the design token system (in `styles/tokens.css`)
- **TanStack React Query 5** for server state
- **Zod 4** for runtime schema validation
- **React Router** for routing
- **lucide-react** for icons

## Data Model the Frontend Sees

The platform is built around **calibration projects**. Each project owns:
- A **rubric** = a set of `criteria`. Every criterion has its own `scale_min`, `scale_max`, and `anchor_descriptions` (a JSON object keyed by score value).
- A **dataset** = a set of `applications` and `human_scores`.
- An ordered list of **iterations** = versioned prompt sets.
- **Scoring jobs** + **llm_scores** produced from those iterations.
- **Agreement metrics** comparing LLM scores against humans (and humans against each other for the H-H baseline).
- A final **locked prompt** when the project state machine reaches `locked`.

State machine: `setup → baseline_computed → iterating → test_run_complete → locked | abandoned → archived`. Routes are nested under `/projects/:projectId/<phase>`.

## Frontend Invariants

These mirror the backend invariants — UI must respect them.

1. **Score scales are per-criterion, not global.** Never hardcode `[1, 2, 3]`. Read `scale_min`/`scale_max` from the criterion. See "Score Scale Convention" below.
2. **Don't compute medians or comparisons on the client.** Those are server-derived endpoints. The frontend just renders.
3. **Don't recompute aggregate counts.** `application_count`, `iteration_count`, `latest_dev_qwk`, etc. come from the backend. Don't `data.applications.length`.
4. **A project has exactly one rubric and one dataset.** No "select rubric" UI — the rubric is intrinsic to the project. To reuse, clone the project.

## Design Token System

All colors, spacing, typography, and shadows come from CSS custom properties defined in `frontend/src/styles/tokens.css`. Three themes are supported via `[data-theme]` on `<html>`: `light`, `dark`, `contrast`.

### Using tokens

Prefer the CSS variable directly in Tailwind's arbitrary value syntax:

```tsx
// Good — uses the design token
<div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)]">

// Good — simple Tailwind utilities that don't conflict with tokens
<div className="flex gap-3 items-center px-4 py-3">

// Bad — hardcoded colors bypass theming
<div className="bg-white border-gray-200">

// Bad — inline styles for things tokens cover
<div style={{ background: "#ffffff", borderColor: "#e4e4e7" }}>
```

### Color tokens (key ones)

| Token | Use |
|-------|-----|
| `--bg`, `--bg-elevated`, `--bg-sunken` | Page, cards, recessed surfaces |
| `--border`, `--border-strong`, `--border-subtle` | Borders |
| `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-faint` | Text hierarchy |
| `--accent`, `--accent-hover`, `--accent-bg` | Brand / primary actions |
| `--green`, `--green-bg`, `--green-border`, `--green-fg` | Traffic light green / success |
| `--yellow`, `--yellow-bg`, `--yellow-border`, `--yellow-fg` | Traffic light yellow / warning |
| `--red`, `--red-bg`, `--red-border`, `--red-fg` | Traffic light red / danger |

### Typography tokens

- Sans: `font-[var(--font-sans)]` (Inter)
- Mono: `font-[var(--font-mono)]` (JetBrains Mono) — for IDs, numbers, code, timestamps
- Use `tabular-nums` for number alignment: `[font-variant-numeric:tabular-nums]`

### When to use inline styles

Use inline `style` for:
- Dynamic values computed at runtime (e.g., gauge positions, histogram bar heights)
- One-off layout adjustments that aren't reusable

Never use inline `style` for colors, borders, shadows, or radii — always use tokens.

## Score Scale Convention

Every criterion carries its own scale. The same project may have one criterion on a 1-3 scale and another on 1-5 (rare but legal). Every score-rendering component must read the scale from the criterion.

```tsx
// Compute the score domain once per criterion
const scoreOptions = useMemo(
  () => Array.from(
    { length: criterion.scale_max - criterion.scale_min + 1 },
    (_, i) => criterion.scale_min + i,
  ),
  [criterion.scale_min, criterion.scale_max],
);

// Anchor descriptions are keyed by stringified score value
const anchorFor = (score: number) => criterion.anchor_descriptions[String(score)] ?? "";

// Histograms / gauges / pickers iterate `scoreOptions`, not `[1, 2, 3]`
{scoreOptions.map((s) => (
  <ScoreCell key={s} score={s} description={anchorFor(s)} />
))}
```

Bad examples that will be rejected in review:

```tsx
// ❌ Hardcoded 1-3 scale
{[1, 2, 3].map(...)}

// ❌ Hardcoded 1-5 scale
const SCORES = [1, 2, 3, 4, 5];

// ❌ Assumed "low/medium/high" mapping
const labels = { 1: "low", 2: "medium", 3: "high" };
```

## Server-Computed Values

The backend owns:
- **Medians** of human scores. Comes from a derived endpoint, not aggregated on the client.
- **Comparisons** (`llm_score` vs human median: match / higher / lower). Server-derived.
- **Counts** (applications per project, iterations per project, scores per job). Returned in list endpoints.
- **Agreement metrics** (QWK, exact, within-1, Krippendorff). Stored in `agreement_metrics`, returned by metric endpoints.

The frontend never recomputes any of these. If the backend doesn't return what you need, add an endpoint — don't aggregate locally.

## Component Patterns

### UI Primitives (`components/ui/`)

These are the design system building blocks. They live in `frontend/src/components/ui/` and are used everywhere. They are defined in the design handoff and must be implemented faithfully.

```tsx
// components/ui/Card.tsx
interface CardProps {
  title?: string;
  desc?: string;
  action?: React.ReactNode;
  noPad?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Card({ title, desc, action, noPad, className = "", children }: CardProps) {
  return (
    <div className={`bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
            {desc && <div className="text-xs text-[var(--fg-muted)] mt-0.5">{desc}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={noPad ? "" : "px-6 py-5"}>{children}</div>
    </div>
  );
}
```

Rules for UI primitives:
- Export named functions, not default exports
- Props interface defined above the component
- Use design tokens for all visual properties
- Accept `className` for composition
- Keep them presentational — no data fetching, no business logic

### Feature Components (`features/<domain>/`)

Feature components compose UI primitives with domain logic.

```tsx
// features/setup/ApplicationsCard.tsx
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { TrafficLight } from "../../components/ui/TrafficLight";

interface ApplicationsCardProps {
  state: "needs_mapping" | "confirmed";
  onOpenMapping: () => void;
  upload: ApplicationUpload | null;
}

export function ApplicationsCard({ state, onOpenMapping, upload }: ApplicationsCardProps) {
  if (state === "needs_mapping") {
    return (
      <Card title="Applications" desc="412 rows detected. Map columns before continuing.">
        <Banner kind="warn" title="Column mapping required" action={...}>
          ...
        </Banner>
      </Card>
    );
  }
  return (
    <Card title="Applications" desc="CSV or XLSX...">
      ...
    </Card>
  );
}
```

Rules for feature components:
- Live in `features/<domain>/` (e.g., `features/setup/`, `features/iterate/`)
- Import UI primitives from `../../components/ui/`
- Can contain domain-specific layout and conditional rendering
- Data fetching happens in the parent page, not in feature components
- Accept data + callbacks as props

### Page Components (`pages/`)

Pages are route-level components. They fetch data and compose feature components.

```tsx
// pages/SetupPage.tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageHead } from "../components/ui/PageHead";
import { ApplicationsCard } from "../features/setup/ApplicationsCard";
import { RubricCard } from "../features/setup/RubricCard";
import { ScoresCard } from "../features/setup/ScoresCard";
import { useProject } from "../hooks/useProject";

export function SetupPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId!);
  const [showColMap, setShowColMap] = useState(false);

  return (
    <div>
      <PageHead
        eyebrow="Phase 1 of 5 - Setup"
        title="Upload cohort & rubric"
        lede="Three files are needed..."
      />
      <div className="grid gap-4">
        <ApplicationsCard ... />
        <RubricCard ... />
        <ScoresCard ... />
      </div>
    </div>
  );
}
```

Rules for pages:
- One file per route in `pages/`
- Use `useParams` for route params
- Fetch data with React Query hooks (from `hooks/`)
- Compose feature components, don't put complex UI logic here
- Handle loading/error states at this level

## Data Fetching

### API Client (`api/client.ts`)

All API calls go through the authenticated fetch wrapper:

```tsx
const API_BASE = "/api";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("scoring_ai_token");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch<T>(path: string, schema: z.ZodSchema<T>, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }
  const data = await res.json();
  return schema.parse(data);
}
```

Rules:
- Every response is validated against a Zod schema
- Never use `fetch` directly outside `api/client.ts`
- All endpoints go through `apiFetch`

### React Query Hooks (`hooks/`)

```tsx
// hooks/useProject.ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { ProjectResponseSchema } from "../schemas";

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiFetch(`/projects/${projectId}`, ProjectResponseSchema),
    enabled: !!projectId,
  });
}

export function useProjects(state?: string) {
  return useQuery({
    queryKey: ["projects", { state }],
    queryFn: () => apiFetch(`/projects?${state ? `state=${state}` : ""}`, ProjectsListResponseSchema),
  });
}
```

For mutations:
```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectCreateRequest) =>
      apiFetch("/projects", ProjectResponseSchema, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
```

Rules:
- One hook per query/mutation concern
- `queryKey` includes all parameters that affect the query
- Use `enabled` to prevent queries from running without required params
- Invalidate related queries on mutation success
- Hook files live in `hooks/`

### Zod Schemas (`schemas/`)

```tsx
// schemas/project.ts
import { z } from "zod";

export const ProjectItemSchema = z.object({
  id: z.number(),
  program_id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  state: z.string(),
  application_count: z.number(),         // derived server-side
  iteration_count: z.number(),           // derived server-side
  latest_dev_qwk: z.number().nullable(), // derived server-side
  updated_at: z.string(),
});

export const ProjectsListResponseSchema = z.object({
  projects: z.array(ProjectItemSchema),
});

// Derive TypeScript types from schemas
export type ProjectItem = z.infer<typeof ProjectItemSchema>;
export type ProjectsListResponse = z.infer<typeof ProjectsListResponseSchema>;
```

Rules:
- Zod schemas are the source of truth for API response shapes
- Derive TypeScript types with `z.infer<>` — don't duplicate as interfaces
- Schema names match the Pydantic model names from the backend
- One schema file per domain, re-exported from `schemas/index.ts`
- Counts and metric values on a `*Item` are derived/computed server-side; never recompute them on the client from sub-resources

## Routing

```tsx
// App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { ProjectsDashboard } from "./pages/ProjectsDashboard";
import { SetupPage } from "./pages/SetupPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/projects" element={<ProjectsDashboard />} />
          <Route path="/projects/:projectId/setup" element={<SetupPage />} />
          <Route path="/projects/:projectId/baseline" element={<BaselinePage />} />
          <Route path="/projects/:projectId/iterate" element={<IteratePage />} />
          <Route path="/projects/:projectId/test-result" element={<PostTestPage />} />
          <Route path="/projects/:projectId/score" element={<ScorePage />} />
          <Route path="/projects/:projectId/revalidate" element={<RevalidatePage />} />
          <Route path="/" element={<Navigate to="/projects" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

Rules:
- `AppShell` is the layout route (renders sidebar + topbar + `<Outlet />`)
- Project pages are nested under `/projects/:projectId/`
- Use `useParams` to access route params
- Use `useNavigate` for programmatic navigation
- Use `<Link>` for navigation, never `<a href>`

## Styling Rules

### CSS class ordering

Follow this order in `className`:
1. Layout: `flex`, `grid`, `block`, `inline-flex`
2. Sizing: `w-`, `h-`, `min-w-`, `max-w-`
3. Spacing: `p-`, `m-`, `gap-`
4. Typography: `text-`, `font-`, `leading-`, `tracking-`
5. Colors: `bg-`, `text-`, `border-`
6. Effects: `shadow-`, `opacity-`, `rounded-`
7. States: `hover:`, `focus:`, `disabled:`

### Button styles

Use these CSS classes from the design system (defined in `tokens.css`):

```tsx
// Primary action
<button className="btn btn-primary">Save</button>

// Default/secondary
<button className="btn">Cancel</button>

// Ghost (no border)
<button className="btn btn-ghost">Show details</button>

// Danger
<button className="btn btn-danger">Delete</button>

// Small variant
<button className="btn btn-sm">Edit</button>

// With icon
<button className="btn btn-primary btn-sm">
  <Lock className="w-3.5 h-3.5" /> Lock prompt
</button>
```

### Icons

Use `lucide-react`. Import individual icons:

```tsx
import { Lock, ChevronRight, Upload, AlertTriangle } from "lucide-react";

// In JSX — always set explicit size
<Lock className="w-3.5 h-3.5" />
<ChevronRight className="w-4 h-4 text-[var(--fg-faint)]" />
```

Map from prototype icon names to lucide-react:
- `lock` -> `Lock`
- `unlock` -> `Unlock`
- `check` -> `Check`
- `checkCircle` -> `CheckCircle`
- `x` -> `X`
- `chev` -> `ChevronRight`
- `chevDown` -> `ChevronDown`
- `plus` -> `Plus`
- `info` -> `Info`
- `warn` -> `AlertTriangle`
- `upload` -> `Upload`
- `download` -> `Download`
- `edit` -> `Pencil`
- `play` -> `Play`
- `refresh` -> `RefreshCw`
- `rotate` -> `RotateCcw`
- `eye` -> `Eye`
- `eyeOff` -> `EyeOff`
- `search` -> `Search`
- `bell` -> `Bell`
- `settings` -> `Settings`
- `user` -> `User`
- `folder` -> `Folder`
- `file` -> `File`
- `layers` -> `Layers`
- `history` -> `History`
- `target` -> `Target`
- `flag` -> `Flag`
- `sparkles` -> `Sparkles`
- `book` -> `BookOpen`
- `split` -> `Split`
- `listChecks` -> `ListChecks`
- `cohort` -> `Users`
- `chart` -> `BarChart3`
- `arrowRight` -> `ArrowRight`
- `arrowLeft` -> `ArrowLeft`
- `shield` -> `Shield`
- `dollar` -> `DollarSign`
- `zap` -> `Zap`
- `diff` -> `GitCompare`
- `moreH` -> `MoreHorizontal`

## File Organization

```
frontend/src/
├── styles/
│   └── tokens.css                 # Design tokens (3 themes) + base styles
├── components/
│   └── ui/                        # Design system primitives
│       ├── Banner.tsx
│       ├── Card.tsx
│       ├── Histogram.tsx
│       ├── Modal.tsx
│       ├── PageHead.tsx
│       ├── QwkGauge.tsx
│       ├── Spark.tsx
│       ├── StatusPill.tsx
│       ├── TrafficBadge.tsx
│       └── TrafficLight.tsx
├── layouts/
│   └── AppShell.tsx               # Sidebar + topbar + Outlet
├── pages/                         # Route-level components
│   ├── ProjectsDashboard.tsx
│   ├── SetupPage.tsx
│   ├── BaselinePage.tsx
│   ├── IteratePage.tsx
│   ├── PostTestPage.tsx
│   ├── ScorePage.tsx
│   └── RevalidatePage.tsx
├── features/                      # Domain-specific composites
│   ├── setup/
│   ├── iterate/
│   ├── posttest/
│   └── score/
├── hooks/                         # React Query hooks
│   ├── useProjects.ts
│   ├── useProject.ts
│   ├── useBaseline.ts
│   └── useIterations.ts
├── schemas/                       # Zod schemas + derived types
│   ├── project.ts
│   ├── baseline.ts
│   └── index.ts
├── api/
│   └── client.ts                  # Authenticated fetch wrapper
├── auth/
│   ├── AuthContext.tsx
│   └── LoginPage.tsx
├── App.tsx                        # Router setup
└── main.tsx                       # Entry point
```

## Checklist for Every Frontend Feature

1. [ ] Cross-checked against **Frontend Invariants** above (no hardcoded scale, no client-side medians/counts, etc.)
2. [ ] Zod schema added in `schemas/` matching backend response shape; counts/metrics included as derived fields
3. [ ] React Query hook in `hooks/` for data fetching
4. [ ] UI primitives used from `components/ui/` (never rebuild Card, Banner, etc.)
5. [ ] Feature component in `features/<domain>/` composing primitives
6. [ ] Page component in `pages/` wiring data to feature components
7. [ ] Score-rendering uses `criterion.scale_min`/`scale_max` — no hardcoded `[1, 2, 3]` or `SCORES = [...]`
8. [ ] All colors use CSS variable tokens — no hardcoded hex values
9. [ ] Icons from `lucide-react` — no inline SVGs
10. [ ] Tested in browser at `http://localhost:5173` with the dev server running
11. [ ] Works in all three themes (light, dark, contrast)
