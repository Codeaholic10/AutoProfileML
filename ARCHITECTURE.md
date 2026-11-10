# ARCHITECTURE.md — Technical Specification

**System:** AutoProfileML
**Document version:** 1.0 · 2026-10-18
**Companion documents:** [PRD.md](PRD.md) · [CLAUDE.md](CLAUDE.md) · [PLAN.md](PLAN.md)

---

## 1. System Overview

AutoProfileML is a two-tier application:

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser                                                          │
│  Next.js 16 App Router (React 19, TypeScript, Tailwind, shadcn)  │
│  - Server Components: initial dataset/profile fetches            │
│  - Client Components: uploads, job polling, interactive charts   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ REST/JSON over HTTP
                                │ multipart uploads, 200 MB cap
┌───────────────────────────────▼──────────────────────────────────┐
│ FastAPI backend (single Uvicorn process)                         │
│                                                                  │
│  api/routes ──► services ──► storage (Storage ABC)               │
│       │             │             └── LocalStorage → ./data      │
│       │             ├── Polars ingestion + profiling             │
│       │             ├── sklearn preprocessing + benchmarking     │
│       │             └── SHAP explainability                      │
│       └──► core/jobs (in-process JobStore)                       │
└──────────────────────────────────────────────────────────────────┘
```

**Runtime state**

| State | Location | Survives restart? |
| --- | --- | --- |
| Dataset files | `data/datasets/{dataset_id}/` | Yes |
| Dataset metadata | `data/datasets/{dataset_id}/dataset.json` | Yes |
| Profile report | `data/profiles/{dataset_id}.json` | Yes |
| Benchmark runs | `data/benchmarks/{benchmark_id}/run.json` (planned) | Yes |
| Explanations | `data/benchmarks/{benchmark_id}/explanations/` (planned) | Yes |
| Exported artifacts | `data/artifacts/` (P1) | Yes |
| Job records | Process memory (`JobStore`) | **No** |
| Upload bytes in flight | Request memory | No |

**Current implementation status**

- Implemented: upload, ingestion, profiling, VIF, warnings, dataset listing, re-profiling,
  job polling, local storage.
- Planned: preprocessing, benchmark arena, SHAP, explanation UI, benchmark persistence,
  delete endpoint, P1 export.

---

## 2. Data Models

The API contract is defined once in Pydantic (`backend/app/models/`) and mirrored by hand in
TypeScript (`frontend/src/types/api.ts`). Datetimes are timezone-aware UTC and serialized as
ISO 8601 strings. Field names are `snake_case` on both sides — do not introduce a
camelCase transform layer.

### 2.1 Existing models (`app/models/schemas.py`)

```python
class JobStatus(str, Enum):
    QUEUED = "queued"; RUNNING = "running"; SUCCEEDED = "succeeded"; FAILED = "failed"

class DatasetSummary(BaseModel):
    dataset_id: str
    filename: str
    format: Literal["csv", "parquet"]
    size_bytes: int
    uploaded_at: datetime
    row_count: int | None          # discovered during profiling
    column_count: int | None

class TopValue(BaseModel):
    value: str
    count: int
    percentage: float

class ColumnProfile(BaseModel):
    name: str
    dtype: str
    semantic_type: Literal["numeric", "categorical", "boolean", "temporal", "unknown"]
    null_count: int
    null_percentage: float
    unique_count: int
    is_constant: bool
    mean: float | None
    std: float | None
    minimum: float | None
    maximum: float | None
    q1: float | None
    median: float | None
    q3: float | None
    skewness: float | None
    kurtosis: float | None        # excess kurtosis (Fisher)
    top_values: list[TopValue]    # max 5, categorical/boolean only

class CollinearityFinding(BaseModel):
    feature: str
    vif: float
    severity: Literal["ok", "moderate", "severe"]   # ok < 5 ≤ moderate < 10 ≤ severe
    correlated_with: str | None

class ProfilingWarning(BaseModel):
    code: str                      # constant_column, high_missingness, ...
    severity: Literal["info", "warning", "critical"]
    column: str | None
    message: str

class CorrelationMatrix(BaseModel):
    features: list[str]
    values: list[list[float]]          # Pearson r, rounded to 4 decimals

class ProfileReport(BaseModel):
    dataset_id: str
    row_count: int
    column_count: int
    memory_bytes: int
    duplicate_rows: int
    duplicate_percentage: float
    generated_at: datetime
    duration_ms: float
    numeric_columns: int
    categorical_columns: int
    columns: list[ColumnProfile]
    collinearity: list[CollinearityFinding]
    correlation: CorrelationMatrix | None   # None when < 2 numeric features
    warnings: list[ProfilingWarning]

class JobRecord(BaseModel):
    job_id: str
    kind: Literal["profiling", "benchmark"]   # → add "explanation", "export" in Phase 7
    status: JobStatus
    progress: float                          # clamped 0.0–1.0
    stage: str                               # queued, loading, scanning, profiling, ...
    dataset_id: str | None
    created_at: datetime
    updated_at: datetime
    error: str | None
    result: dict[str, Any] | None

class DatasetUploadResponse(BaseModel):
    dataset: DatasetSummary
    job: JobRecord

class DatasetListItem(BaseModel):
    dataset: DatasetSummary
    has_profile: bool
    latest_job: JobRecord | None
```

**Relationships:** a `DatasetSummary` 1—1 `ProfileReport`; a dataset 1—N profiling jobs and
1—N `BenchmarkRun`s; a `BenchmarkRun` 1—N `ModelResult`s and 0—N `ExplanationReport`s. All
references are by string ID; no foreign keys or cascading deletes are enforced by a database.
Deleting a dataset must delete its profiles, benchmarks, explanations, and artifacts in the
service layer.

### 2.2 Planned models (Phases 6–8)

```python
# app/models/benchmark.py
class TaskType(str, Enum):
    CLASSIFICATION = "classification"
    REGRESSION = "regression"

class BenchmarkCreateRequest(BaseModel):
    target: str
    task_type: TaskType | None = None       # None → infer and return the decision
    excluded_features: list[str] = Field(default_factory=list)
    folds: int = Field(default=5, ge=3, le=10)
    random_state: int = 42

class PreprocessingStep(BaseModel):
    kind: Literal[
        "numeric_impute", "categorical_impute", "iqr_clip",
        "one_hot_encode", "target_encode", "standard_scale", "drop",
    ]
    columns: list[str]
    strategy: str | None                    # e.g. "median", "most_frequent"
    parameters: dict[str, float | int | str | bool]

class PreprocessingPlan(BaseModel):
    numeric_features: list[str]
    categorical_features: list[str]
    excluded_features: list[str]
    target_encoding: list[str]              # high-cardinality categoricals
    one_hot_encoding: list[str]
    steps: list[PreprocessingStep]
    notes: list[str]                        # e.g. "3 constant columns dropped"

class ModelResult(BaseModel):
    model_id: str
    name: str                               # "Logistic Regression", "LightGBM", ...
    family: Literal["linear", "random_forest", "lightgbm", "xgboost"]
    status: Literal["succeeded", "failed"]
    metrics: dict[str, float]               # fold means
    metric_std: dict[str, float]
    training_seconds: float
    rank: int | None
    hyperparameters: dict[str, float | int | str | bool | None]
    error: str | None

class BenchmarkRun(BaseModel):
    benchmark_id: str
    dataset_id: str
    target: str
    task_type: TaskType
    task_detection_reason: str
    status: JobStatus
    folds: int
    random_state: int
    sample_rows: int | None                 # null when full data was used
    class_support: dict[str, int]           # classification only; CV row count per class
    created_at: datetime
    updated_at: datetime
    preprocessing: PreprocessingPlan | None
    leaderboard: list[ModelResult]
    best_model_id: str | None
    error: str | None

class OutOfFoldPrediction(BaseModel):
    """One CV test row scored by the fold model that did not train on it."""

    row_index: int
    y_true: str | float
    y_pred: str | float
    probabilities: dict[str, float] | None  # class label → probability; classification only

class OutOfFoldPredictions(BaseModel):
    benchmark_id: str
    model_id: str
    task_type: TaskType
    classes: list[str]                      # classification only
    prediction_count: int
    truncated: bool                         # true when capped to PREDICTION_CAP
    predictions: list[OutOfFoldPrediction]

class BenchmarkSummary(BaseModel):
    benchmark_id: str
    dataset_id: str
    target: str
    task_type: TaskType
    status: JobStatus
    best_model_name: str | None
    primary_metric: str
    primary_metric_value: float | None
    created_at: datetime

class BenchmarkEnqueueResponse(BaseModel):
    benchmark: BenchmarkRun
    job: JobRecord

# app/models/explanation.py
class FeatureImportance(BaseModel):
    feature: str
    mean_abs_shap: float
    rank: int

class ShapContribution(BaseModel):
    feature: str
    value: str | float | None               # original feature value
    contribution: float                     # signed SHAP value

class LocalExplanation(BaseModel):
    row_index: int
    prediction: float
    base_value: float
    contributions: list[ShapContribution]   # sorted by |contribution| desc, capped

class ShapSummaryPoint(BaseModel):
    """One dot for the beeswarm: a sampled row's SHAP value for one feature."""

    feature: str
    feature_value: str | float | None
    shap_value: float

class ExplanationReport(BaseModel):
    explanation_id: str
    benchmark_id: str
    model_id: str
    method: Literal["tree_shap", "linear_shap", "kernel_shap"]
    sample_size: int
    background_size: int
    global_importance: list[FeatureImportance]
    summary_points: list[ShapSummaryPoint]  # top 10 features × sampled rows
    local_explanations: list[LocalExplanation]
    created_at: datetime
    duration_ms: float
    warnings: list[ProfilingWarning]        # reuse the warning shape

class ExplanationCreateRequest(BaseModel):
    model_id: str
    sample_size: int = Field(default=500, ge=50, le=1000)
    local_rows: int = Field(default=10, ge=1, le=25)
```

### 2.3 TypeScript mirror (shape)

```ts
// frontend/src/types/api.ts
export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type SemanticType = "numeric" | "categorical" | "boolean" | "temporal" | "unknown";

export interface DatasetSummary {
  dataset_id: string;
  filename: string;
  format: "csv" | "parquet";
  size_bytes: number;
  uploaded_at: string;
  row_count: number | null;
  column_count: number | null;
}

export interface CorrelationMatrix {
  features: string[];
  values: number[][];
}

export interface ProfileReport {
  dataset_id: string;
  row_count: number;
  column_count: number;
  memory_bytes: number;
  duplicate_rows: number;
  duplicate_percentage: number;
  generated_at: string;
  duration_ms: number;
  numeric_columns: number;
  categorical_columns: number;
  columns: ColumnProfile[];
  collinearity: CollinearityFinding[];
  correlation: CorrelationMatrix | null;
  warnings: ProfilingWarning[];
}

export interface JobRecord {
  job_id: string;
  kind: "profiling" | "benchmark" | "explanation" | "export";
  status: JobStatus;
  progress: number;
  stage: string;
  dataset_id: string | null;
  created_at: string;
  updated_at: string;
  error: string | null;
  result: Record<string, unknown> | null;
}
// Remaining interfaces mirror the Pydantic models 1:1. Zod schemas validate at I/O.
```

### 2.4 On-disk layout

```
data/
├── datasets/
│   └── {dataset_id}/
│       ├── {original_filename}      # sanitized with Path(filename).name
│       └── dataset.json             # DatasetSummary JSON
├── profiles/
│   └── {dataset_id}.json            # ProfileReport JSON
├── benchmarks/                      # planned
│   └── {benchmark_id}/
│       ├── run.json                 # BenchmarkRun JSON
│       ├── preprocessing.json       # serialized PreprocessingPlan
│       ├── models/
│       │   └── {model_id}.joblib    # server-generated fitted pipeline (trusted)
│       ├── predictions/
│       │   └── {model_id}.json      # OutOfFoldPredictions (capped)
│       └── explanations/
│           └── {model_id}.json      # ExplanationReport JSON
└── artifacts/                       # P1 export bundles
```

There is **no database**. Metadata is written atomically-enough for a single-process MVP:
write into a sibling temp file, then `Path.replace()` (add this in Phase 7; current code
writes directly). Readers treat missing/invalid JSON as "not found" where the API contract
allows it.

---

## 3. Authentication & Authorization

**Current MVP: none.** This is a deliberate, documented constraint, not an oversight.

- All `/api/*` endpoints are unauthenticated.
- There are no users, sessions, roles, login routes, middleware, or ownership checks.
- Access control is provided only by deployment topology: the backend binds to localhost
  during development and is not exposed to untrusted networks.
- CORS is restricted to `AUTOPROFILEML_CORS_ORIGINS` (default `http://localhost:3000`) with
  credentials enabled for future compatibility, but no cookies are used.
- The frontend has no route protection and no auth context.

**Rules for agents**

1. Do **not** add authentication, authorization middleware, a users table, JWT, OAuth, or
   Next.js middleware in the MVP. It is explicitly a non-goal in [PRD.md](PRD.md).
2. Do not add `user_id` fields to models "for later"; that creates half-implemented tenancy.
3. If the deployment target changes, treat auth as a new architecture decision and update
   both this document and the PRD before implementing.

**Future design (P1, only when approved)**

- Session-based auth with an httpOnly, SameSite=Lax cookie; no tokens in `localStorage`.
- A `users` table (or identity provider subject) and `owner_id` on datasets and benchmarks.
- Authorization enforced in the service layer for every read/write (not just routes).
- Next.js middleware redirects unauthenticated users; backend returns `401`/`403`
  independently (middleware is UX, not security).
- CORS origins narrowed to the deployed frontend; `allow_credentials=True` becomes required.

---

## 4. API & Data Fetching

### 4.1 API style

- REST/JSON under `/api`; OpenAPI generated by FastAPI at `/docs`.
- No GraphQL, tRPC, or Next.js Server Actions for backend mutations. The backend is a
  separate service; all mutations go through the typed HTTP client.
- Additive changes only within a phase: never rename/remove a response field without updating
  the TypeScript mirror and any persisted JSON readers.
- Multipart for uploads; JSON for everything else.

### 4.2 Endpoints

| Method | Path | Status | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | ✅ | Liveness + version + env |
| POST | `/api/datasets` | ✅ | Upload file (multipart `file`), queue profiling, `202` |
| GET | `/api/datasets` | ✅ | List datasets with `has_profile` + latest job |
| GET | `/api/datasets/{dataset_id}` | ✅ | Dataset metadata |
| DELETE | `/api/datasets/{dataset_id}` | ✅ | Delete dataset, metadata, and stored profile, `204` |
| GET | `/api/datasets/{dataset_id}/profile` | ✅ | Profile report; `409` while not ready |
| POST | `/api/datasets/{dataset_id}/profile` | ✅ | Re-profile, `202` + job |
| GET | `/api/datasets/{dataset_id}/jobs` | ✅ | Job history for a dataset |
| GET | `/api/jobs/{job_id}` | ✅ | Poll any job |
| POST | `/api/datasets/{dataset_id}/benchmarks` | 🔜 | Queue benchmark (target, task, folds), `202` |
| GET | `/api/datasets/{dataset_id}/benchmarks` | 🔜 | Benchmark history (`BenchmarkSummary[]`) |
| GET | `/api/benchmarks/{benchmark_id}` | 🔜 | Full run + leaderboard |
| GET | `/api/benchmarks/{benchmark_id}/models/{model_id}/predictions` | 🔜 | Out-of-fold predictions for confusion matrices, ROC curves, and mistakes |
| POST | `/api/benchmarks/{benchmark_id}/explanations` | 🔜 | Queue SHAP job, `202` |
| GET | `/api/benchmarks/{benchmark_id}/explanations/{model_id}` | 🔜 | Stored explanation or `409` |
| GET | `/api/benchmarks/{benchmark_id}/export` | P1 | Download ZIP bundle |

✅ = implemented · 🔜 = MVP planned · P1 = post-MVP

### 4.3 Status codes & error contract

Errors always use FastAPI's envelope: `{"detail": "<human-readable message>"}`.

| Code | Meaning in this system |
| --- | --- |
| `200` | Read succeeded |
| `202` | Work accepted and queued (upload, profile, benchmark, explanation) |
| `204` | Deletion succeeded |
| `400` | Semantically invalid request (empty upload, unknown target, invalid folds) |
| `404` | Dataset, job, benchmark, or explanation not found |
| `409` | Resource exists but is not ready yet (profile/explanation pending) |
| `413` | Upload exceeds the configured size limit |
| `415` | Unsupported file type |
| `422` | Request schema validation (FastAPI default) |
| `500` | Unexpected server error — no internal details exposed |

Rules: routes translate domain exceptions to these codes and message strings; background job
failures are **not** HTTP errors — they are persisted in `JobRecord.error` and surfaced by the
polling UI. Job errors name the dataset (`Could not profile 'sample.csv': ...`) and never
include a filesystem path.

### 4.4 Job lifecycle

```
POST /upload ──► create JobRecord(queued) ──► BackgroundTasks ──► running
                                                                  │
                                                         ┌────────┴────────┐
                                                         ▼                 ▼
                                                    succeeded          failed
                                                    progress=1.0       error=<type: msg>
```

- Stages for profiling: `queued → loading → scanning → profiling → summarising → completed`
  with progress `0.0 / 0.1 / 0.3 / 0.6 / 0.9 / 1.0`.
- Profiling persists the report and the dataset shape together, only after the frame has been
  fully parsed and profiled. A failure at any stage leaves the previous profile and shape
  untouched.
- Stages for benchmarking (planned): `queued → preparing → training → ranking → completed`.
- Stages for explanations (planned): `queued → loading → explaining → completed`.
- The frontend polls `GET /api/jobs/{job_id}` at ~2 s while non-terminal and stops on
  `succeeded`/`failed`.
- Job retention is 6 hours by default (`AUTOPROFILEML_JOB_RETENTION_SECONDS`), pruned lazily
  on job creation. Persisted results (profiles, benchmark runs) do not expire.
- **Single-process only.** Uvicorn must run with one worker until the job store is replaced
  by Redis/Celery.

### 4.5 Frontend data fetching & caching

| Data | Where fetched | Mechanism | Cache behavior |
| --- | --- | --- | --- |
| Dataset list | Server Component (initial) + client invalidation | `apiFetch` → TanStack Query hydration | `staleTime: 30s`; invalidated after upload/delete |
| Profile report | Server Component (initial) | Direct `apiFetch` in RSC | `cache: "no-store"`; revalidated on re-profile |
| Active job | Client Component | `useQuery` with `refetchInterval` | no cache; poll 2 s; stop on terminal |
| Benchmark run / leaderboard | Server Component initial + client | `apiFetch` + TanStack Query | `staleTime: 60s` for completed runs |
| Explanation | Client | `useQuery`, enabled when job completes | `staleTime: Infinity` (immutable document) |

- The Next.js Data Cache is **not** used for mutable API data; all server-side fetches pass
  `cache: "no-store"` and let TanStack Query own client caching.
- Query keys are centralized:

```ts
export const queryKeys = {
  datasets: {
    list: ["datasets"] as const,
    detail: (id: string) => ["datasets", id] as const,
    profile: (id: string) => ["datasets", id, "profile"] as const,
    benchmarks: (id: string) => ["datasets", id, "benchmarks"] as const,
  },
  jobs: { detail: (id: string) => ["jobs", id] as const },
  benchmarks: {
    detail: (id: string) => ["benchmarks", id] as const,
    explanation: (benchmarkId: string, modelId: string) =>
      ["benchmarks", benchmarkId, "explanations", modelId] as const,
  },
};
```

- Mutations: `useMutation` → on success `queryClient.invalidateQueries`. No manual cache
  surgery.
- HTTP caching headers are not relied on; profiles become stale when re-profiled, and the
  cache is invalidated by key instead of ETags.

### 4.6 Third-party integrations

There are **no external SaaS integrations** (no analytics, auth provider, object storage, or
APIs). Third-party code is limited to open-source libraries in the stack table. ML libraries
run in-process in the backend; the browser never receives model binaries in the MVP.

---

## 5. Machine-Learning Pipeline Architecture (Planned)

All of this lives in `app/services/` and returns plain Pydantic documents. Routes never import
sklearn, LightGBM, XGBoost, or SHAP.

### 5.1 Task detection

`target` is chosen by the user. If `task_type` is omitted:

- **Classification** when the target is string/boolean/categorical, or numeric with
  `unique_count ≤ 20` and `unique_count / row_count ≤ 0.05`.
- **Regression** otherwise.
- The reason string is persisted in `BenchmarkRun.task_detection_reason` and displayed.
- The user may override; invalid targets (all-null, constant, target repeated in exclusions)
  return `400`.

### 5.2 Leakage-free preprocessing

Constructed per run as sklearn estimators, fitted **only on the training fold**:

```
ColumnTransformer
├── numeric
│   ├── AdaptiveNumericImputer          # median, or KNNImputer when fold ≤ 20k rows
│   │                                   # and 5%–50% of values are missing
│   ├── IQRClipper(k=1.5)               # custom, per-fold quantiles
│   └── StandardScaler()                # linear models only
├── low-cardinality categorical
│   ├── SimpleImputer(strategy="most_frequent")
│   └── OneHotEncoder(handle_unknown="ignore")
└── high-cardinality categorical
    ├── SimpleImputer(strategy="most_frequent")
    └── TargetEncoder(smooth="auto", random_state=42)   # fit inside the fold
```

- **Adaptive numeric imputation** (synopsis §5 Phase 2): KNN imputation exploits
  inter-column correlation but its cost grows with rows², so it is chosen at `fit` time only
  for folds ≤ 20,000 rows where 5%–50% of values are missing; otherwise median imputation
  (robust for skewed columns). The chosen strategy is a transformer parameter and appears in
  `PreprocessingPlan.steps`.

- High cardinality threshold: `unique_count / row_count ≥ 0.5` or `unique_count > 50`.
- Constant and all-null columns are dropped and reported in `PreprocessingPlan.notes`.
- IQR clipping bounds are computed on training folds only.
- `remainder="drop"`; the plan is derived from the fitted `ColumnTransformer` so the UI shows
  exactly what ran.
- **Data leakage is a correctness bug.** Any transformer that learns statistics (imputers,
  encoders, scalers, clippers) must be inside the pipeline passed to `cross_validate`.

### 5.3 Benchmark arena

- CV: `StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)` for classification,
  `KFold(...)` for regression. Scoring uses `cross_validate(..., return_train_score=False)`.
- Model registry (each entry: name, family, estimator factory, supported tasks):

| Family | Classification | Regression |
| --- | --- | --- |
| linear | `LogisticRegression(max_iter=1000, class_weight="balanced")` | `Ridge()` |
| random_forest | `RandomForestClassifier(n_estimators=300, n_jobs=-1)` | `RandomForestRegressor(...)` |
| lightgbm | `LGBMClassifier(n_estimators=300, learning_rate=0.05)` | `LGBMRegressor(...)` |
| xgboost | `XGBClassifier(n_estimators=300, learning_rate=0.05, tree_method="hist")` | `XGBRegressor(...)` |

- Metrics: classification — accuracy, macro F1, ROC-AUC (binary; OvR weighted for
  multiclass), log loss. Regression — RMSE, MAE, R².
- **Out-of-fold predictions:** during the CV pass, each fold's test rows are scored by the
  fold model and retained. They feed confusion matrices, ROC curves, and the
  highest-confidence-mistakes view. Persisted per model with a row cap
  (`PREDICTION_CAP = 20_000`, deterministic head slice, `truncated=True` when applied).
  The evaluation sample size is independent of the training cap.
- Models run **sequentially** in a fixed order (ADR-9); the job stage names the model in
  flight so the UI still shows meaningful progress.
- Primary ranking metric: macro F1 (classification), RMSE (regression). Rank only succeeded
  models.
- Each model runs in isolation; an exception marks only that `ModelResult` failed.
- Training data is capped at 250,000 rows; above that a fixed-seed sample is drawn and
  `sample_rows` is set (visible warning in the UI).
- Cross-validation metrics describe fold performance. After ranking, each succeeded pipeline
  is **refit on the full (or sampled) dataset** with the same hyperparameters and persisted
  with joblib to `data/benchmarks/{benchmark_id}/models/{model_id}.joblib`. SHAP and P1 export
  operate on that persisted, server-generated artifact. Document this distinction in the UI
  ("metrics: 5-fold CV; explanations: full-data refit").
- Only server-generated joblib files are ever loaded. Validate that `model_id` belongs to the
  requested benchmark before resolving a path; never accept a model path from the client.
- Run-level failure (bad target, unreadable file) marks the job failed; per-model failures do
  not.

### 5.4 Explainability

- Load the persisted pipeline for the requested `model_id` from the benchmark directory;
  reject unknown IDs with `404` and path traversal attempts before touching the filesystem.
- Method: `TreeExplainer` for RF/LightGBM/XGBoost, `LinearExplainer` for linear models.
- Explanation is a separate job so a slow or failed SHAP run never invalidates a completed
  leaderboard.
- Background/evaluation sample ≤ 1,000 rows, fixed seed 42; global importance is mean
  |SHAP| per feature; per-row contributions are capped to the top 15 by absolute value.
- `summary_points` carries the top 10 features × sampled rows for the beeswarm, rounded and
  bounded so the JSON stays small.
- Feature names come from `preprocessor.get_feature_names_out()`; they may be encoded
  (`onehot__city_mumbai`, `target__postal_code`). Preserve the original column name alongside
  the encoded name where possible so the UI can group one-hot variants under their source
  column.
- Output is JSON (`ExplanationReport`), never raw NumPy arrays.
- Kernel SHAP is a fallback only for unsupported model families, with a hard sample cap.

### 5.5 Code export (P1)

- Generate a commented standalone script from `PreprocessingPlan` + model hyperparameters,
  using sklearn `Pipeline` construction — not string templates with untrusted input.
- Serialize the fitted pipeline with joblib; optionally export ONNX only after a feasibility
  spike (`skl2onnx` support for LightGBM/XGBoost/TargetEncoder must be verified).
- Bundle script, notebook, and artifacts into a ZIP under `data/artifacts/{benchmark_id}/`.
- Never execute generated code in the backend; only render it for download.

---

## 6. Golden Pattern

This is the canonical full-stack slice for a new endpoint. Copy the structure, not the domain
names. It demonstrates: dependency injection, service ownership, domain-error translation,
typed response models, background job dispatch, Zod validation at the client boundary, and
terminal-aware polling.

### Backend route

```python
"""Benchmark endpoints."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.deps import get_benchmark_service
from app.models.benchmark import BenchmarkCreateRequest, BenchmarkEnqueueResponse
from app.services.benchmarking import BenchmarkService
from app.services.datasets import DatasetNotFoundError

router = APIRouter(prefix="/api", tags=["benchmarks"])


@router.post(
    "/datasets/{dataset_id}/benchmarks",
    response_model=BenchmarkEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Queue a benchmark run for a target column",
)
async def create_benchmark(
    dataset_id: str,
    payload: BenchmarkCreateRequest,
    background_tasks: BackgroundTasks,
    service: BenchmarkService = Depends(get_benchmark_service),
) -> BenchmarkEnqueueResponse:
    """Validate the request, persist a queued run and start it in the background."""

    try:
        run, job = service.enqueue(dataset_id, payload)
    except DatasetNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    background_tasks.add_task(service.run_benchmark, run.benchmark_id, job.job_id)
    return BenchmarkEnqueueResponse(benchmark=run, job=job)
```

### Frontend consumer

```ts
// src/lib/api/client.ts — the only place that calls fetch
import { z } from "zod";

export class ApiError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(detail);
    this.name = "ApiError";
  }
}

const ErrorBodySchema = z.object({ detail: z.string() });

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const parsed = ErrorBodySchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.detail : "Request failed.",
    );
  }
  return schema.parse(await response.json());
}

// src/features/jobs/use-job.ts — poll only while non-terminal
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ""),
    queryFn: () => apiFetch(`/api/jobs/${jobId}`, JobRecordSchema),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "succeeded" || status === "failed" ? false : 2000;
    },
  });
}
```

**Pattern rules**

- Route = validation + one service call + error translation. Nothing else.
- Service returns domain objects; the route's `response_model` serializes them.
- The service, not the route, creates the `.json` document and registers the job.
- Background work receives IDs, reloads what it needs, and records failure on the job.
- Every client call parses Zod at the boundary and throws `ApiError` with the server's
  `detail` string.

---

## 7. Cross-Cutting Concerns

### 7.1 Configuration

`app/core/config.py` uses `AUTOPROFILEML_*` env vars (`.env` supported). Frontend uses
`NEXT_PUBLIC_API_BASE_URL` only. No other runtime magic constants; thresholds live as named
module constants (e.g., VIF limits) with tests.

### 7.2 Security

| Risk | Mitigation (MVP) |
| --- | --- |
| Path traversal via filename | `Path(filename).name` in `LocalStorage.dataset_path`; IDs are UUID hex |
| Unbounded uploads | `max_upload_mb` validated before write; 200 MB default |
| Malformed datasets | Format allow-list; Polars parse errors surface as failed jobs |
| Pickle deserialization | Only server-generated joblib artifacts are loaded; the path is resolved from validated benchmark/model IDs, never from client input. No user-supplied pickle is ever loaded. |
| XSS | React escaping; no `dangerouslySetInnerHTML`; dataset values rendered as text |
| SSRF / external calls | None — backend makes no outbound requests |
| Unauthorized access | Not solved in MVP; localhost/trusted-network deployment only |
| DoS via expensive runs | Single-user model, size caps, VIF/SHAP caps, 6 h job retention |
| Secret leakage | No secrets required; `.env` gitignored; errors sanitized |

### 7.3 Performance

- Ingestion uses Polars lazy scans for schema/row counts; profiling materializes the frame
  (MVP limitation).
- VIF capped at 40 numeric features; correlation computed on a complete-case matrix.
- Benchmarks cap at 250k rows with sampling above that; 5 folds; 300 trees.
- SHAP ≤ 1,000 rows.
- Uploads are read fully into memory today; a streaming write is a P1 hardening item.
- Frontend code-splits charts; Recharts renders only visible panels; large tables virtualize
  only if profiling exceeds ~1,000 columns (unlikely).

### 7.4 Observability

- Structured-ish logging via `logging` at INFO (`uvicorn` access logs plus job lifecycle).
- Job errors are persisted and user-visible; no external telemetry.
- `GET /health` reports status, version, env.
- No tracing/metrics in MVP; add only with a deployment story.

### 7.5 Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit (backend) | pytest | Profiling math, VIF edge cases, preprocessing plan, metrics |
| Integration (backend) | pytest + `TestClient` | Upload → profile → poll → fetch, error codes |
| Leakage regression | pytest | Encoders/imputers fitted only on train folds |
| Frontend unit | Vitest + Testing Library | Query hooks, components, polling terminality |
| Frontend API | MSW | Loading/error/empty states |
| End-to-end (P1) | Playwright (optional) | Upload → profile → benchmark happy path |

---

## 8. Architecture Decisions

| # | Decision | Rationale | Consequences |
| --- | --- | --- | --- |
| ADR-1 | Separate Next.js and FastAPI services | Heavy Python ML work must not block UI rendering; matches synopsis. | Two processes, CORS, explicit API contract. |
| ADR-2 | File-backed JSON instead of a database | No multi-user requirement; simplest durable store; transparent artifacts. | No transactions/queries; single-process assumptions; migration needed if auth arrives. |
| ADR-3 | In-process `BackgroundTasks` + `JobStore` | Zero infrastructure; sufficient for a single-user MVP. | Jobs lost on restart; one Uvicorn worker only; queue abstraction kept swappable. |
| ADR-4 | Polars as the only dataframe engine | Fast, multithreaded, memory-efficient; synopsis requirement. | Contributors must not use pandas; some sklearn interop needs NumPy conversion. |
| ADR-5 | REST + TanStack Query, no Next Server Actions for backend data | Backend is external and authoritative; predictable caching and polling. | More explicit client code; no RSC mutation magic. |
| ADR-6 | sklearn `Pipeline` fitted inside CV | Eliminates target leakage structurally. | Slightly slower training; custom transformers (IQR clipping) must be picklable. |
| ADR-7 | No auth in MVP | Explicit non-goal; keeps academic scope achievable. | Not safe for public deployment; documented limitation. |
| ADR-8 | SHAP as a separate job | Explanations are slow and optional; must not fail a good benchmark. | Extra user step and endpoint. |
| ADR-9 | Models train sequentially inside one job (synopsis says "concurrent") | Process pools roughly double peak memory on development laptops, complicate progress reporting, and introduce pickling/deadlock failure modes; training time is dominated by the largest model anyway. | Total wall time equals the sum of model times; per-model progress is reported per model. Revisit only if a benchmark exceeds the 10-minute target with parallelism available. |
| ADR-10 | Out-of-fold predictions persisted for classification | Confusion matrices and ROC curves (synopsis §5 Phase 4) need predictions beyond aggregate metrics. | Extra JSON per model, capped to a documented row count. |

## 9. Known Limitations & Technical Debt

Verified on 2026-10-21 against the running backend after Phase 1 (39 tests pass; lint, format,
and strict mypy clean; upload → profile → failed re-profile → restart exercised over HTTP):

1. **Job state is volatile**; profiles and benchmark results are durable, progress is not.
2. **Uploads are fully buffered in memory** (up to 200 MB) — a streaming implementation is
   P1.
3. **Profiling materializes the full frame**; very wide/large datasets may hit memory limits.
4. **Dataset deletion is scoped to what exists today** — it removes the dataset directory and
   stored profile. Benchmark runs and explanations are added to `delete_dataset` when those
   phases start writing them.
5. **Benchmark results are not yet modeled or persisted.**
6. **No CI** — `backend/scripts/check.sh` is the local quality gate until P1 adds CI.
