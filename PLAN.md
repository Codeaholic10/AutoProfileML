# PLAN.md — Atomic Execution Roadmap

**Product:** AutoProfileML MVP
**Scope:** [PRD.md](PRD.md) P0 features only; P1 is isolated in Phase 11.
**Rules:** [CLAUDE.md](CLAUDE.md)
**Technical contract:** [ARCHITECTURE.md](ARCHITECTURE.md)

---

## How to Use This Roadmap

- Work phases **in order**. Do not start a phase until the previous phase's verification
  passes.
- Every unchecked item is an atomic task intended to take **10–15 minutes**. If a task takes
  longer, split it rather than working past the boundary.
- `- [x]` means the behavior already exists in the repository and is covered by passing
  tests. Do not re-implement it.
- Tick boxes as work lands. When a task changes the contract, update
  [ARCHITECTURE.md](ARCHITECTURE.md) and the TypeScript mirror in the same change.
- Run the phase verification **before** moving on. A phase is not done because the code
  compiles; it is done because the verification below it passes.
- Commit at the end of each phase, not at the end of the project.

---

## Synopsis Alignment — Methodology Phases vs. This Roadmap

`AutoProfileML_Synopsis.pdf` §5 defines **five pipeline phases** in sequence. This roadmap has
more phases because engineering steps that would otherwise be undocumented (tooling, frontend
scaffolding, the API data layer) are split out. The synopsis phases therefore map to roadmap
phases **1:1, in the same order**, and every synopsis bullet has a home:

| Synopsis phase (§5) | Synopsis deliverables | Roadmap phases | Notes |
| --- | --- | --- | --- |
| **1. High-Throughput Ingestion & Profiling Engine** | Polars CSV/Parquet ingestion; dtypes, missing %, skewness, kurtosis, VIF; JSON metadata payload to the frontend | Phase 0 (backend) + Phases 2–5 (frontend) | Backend done. The JSON payload is delivered through REST rather than "sent straight back" on the upload response (202 + job, then poll) so large profiles never block the request. |
| **2. Leakage-Free Preprocessing & Feature Engineering** | **Adaptive imputation:** median for skewed numeric, **KNN-based imputation** for complex missingness, constant/mode for categorical; one-hot (low cardinality) vs target encoding (high cardinality) fitted inside folds; IQR clipping | **Phase 6** | ⚠ **KNN is bounded, not unconditional:** `KNNImputer` is quadratic in rows, so the adaptive imputer uses it only when missingness is complex *and* the training fold is under a row cap (documented threshold); otherwise median. Both paths live inside the fold pipeline. See the Phase 6 tasks. |
| **3. Benchmark Arena & Model Optimization** | Task identification from the target; **concurrent training** of Ridge/Logistic Regression, Random Forest, LightGBM, XGBoost; consistent metrics and a leaderboard | **Phase 7** | ⚠ **"Concurrent" is adapted:** models train one at a time inside a single job. Parallel process pools roughly double peak memory on the development laptops this targets, and their failure modes (deadlocks, pickling) cost more than they save. Models stay isolated so each still runs independently of the others' results. Recorded as ADR-9 in ARCHITECTURE.md. |
| **4. Model Explainability & Visual Telemetry** | TreeSHAP for the top ensemble models — global importance and per-row explanations; **confusion matrices, ROC curves**, metrics, SHAP summary plots streamed to the dashboard | **Phase 8** (SHAP) + **Phase 9** (visuals) | Confusion matrices and ROC curves were missing from the original roadmap; they are now itemized under Phase 9. |
| **5. Code Synthesis & Artifact Generation** *(feasibility TBC)* | AST-based commented script, `.pkl` and `.onnx` binaries plus `.ipynb`, bundled as a ZIP | **Phase 11** (P1) | Kept post-MVP in both documents. The roadmap resolves the synopsis's "AST-based" wording: generate code with sklearn `Pipeline` builders (a template renderer) and validate it via `ast.parse`, not `ast.unparse`. `.onnx` stays feasibility-gated. |

**Conclusion:** the roadmap does not drop, merge, or reorder any synopsis phase. The three ⚠
adaptations (imputation, concurrency, AST wording) are deliberate, justified differences recorded
here and in [ARCHITECTURE.md](ARCHITECTURE.md); they are not drift.

---

## Phase 0 — Baseline (Already Implemented)

**Goal:** The profiling backend that exists today, verified before any new work.

- [x] FastAPI app factory, CORS, versioned `/health` endpoint (`app/main.py`).
- [x] Environment-driven settings with `AUTOPROFILEML_*` prefix (`app/core/config.py`).
- [x] Thread-safe, retention-aware in-process job registry (`app/core/jobs.py`).
- [x] Pydantic contract for datasets, profiles, warnings, jobs (`app/models/schemas.py`).
- [x] Storage ABC with local-disk implementation and factory (`app/storage/`).
- [x] CSV/Parquet format detection, size validation, lazy Polars scans (`ingestion.py`).
- [x] Dataset registry, upload persistence, profile persistence, background orchestration
      (`services/datasets.py`).
- [x] Statistical profiling, VIF, warning generation (`services/profiling.py`).
- [x] Upload/list/detail/profile/re-profile/job REST endpoints (`api/routes/datasets.py`).
- [x] Test coverage across profiling, services, and API integration (`tests/`).
- [x] The frontend directory exists but is empty; no frontend code has been written.

**Verification**

```bash
cd backend
source .venv/Scripts/activate
pytest -q                          # 39 passed
uvicorn app.main:app --port 8000   # http://localhost:8000/health → {"status":"ok",...}
```

---

## Phase 1 — Repository Hygiene & Tooling

**Goal:** A clean, enforceable baseline: no lint debt, a type checker, ignored runtime
artifacts, and repeatable commands.

- [x] Add root `.gitignore` covering `.venv/`, `node_modules/`, `.next/`, `data/`, `.env`,
      `.env.local`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, `*.egg-info/`,
      coverage output, and OS files.
- [x] Strip the UTF-8 BOM from all 22 Python files (`app/` and `tests/`); this is the root
      cause of the `ruff format --check` panic on Ruff 0.16.8.
- [x] Fix the 14 existing `ruff check` findings: add a per-file `B008` ignore for FastAPI
      route modules, wrap the 2 long lines, and migrate `JobStatus` to `enum.StrEnum`.
- [x] Run `ruff format .` and commit the formatting-only diff.
- [x] Add a regression test: a failed re-profile must leave the existing dataset shape and
      profile untouched.
- [x] Fix `run_profiling` so shape metadata and the profile are persisted only after the
      frame loads and profiling succeeds; a failure must preserve the previous consistent
      state.
- [x] Name the dataset (not a filesystem path) in job error messages.
- [x] Map an empty upload to `400` (invalid) while keeping oversized uploads at `413`, and
      update the API tests.
- [x] Add `mypy>=2.4.0` to `backend/pyproject.toml` dev extras and configure
      `[tool.mypy]` (`python_version = "3.11"`, `strict = true`, `warn_unused_ignores`).
- [x] Confirm no mypy overrides are required: Polars and NumPy ship usable annotations and
      `mypy app` passes in strict mode without per-module ignores.
- [x] Run `mypy app` and fix model typing errors in `app/models/` (replace the one `Any`
      boundary only if a precise type is available; otherwise document the exception).
- [x] Fix the 5 strict-mode mypy errors: annotate `_metadata_path`/`_profile_path`
      returns, parameterize the remaining `dict` annotations, and type the VIF severity
      literal.
- [x] Fix mypy errors in `app/core/` and `app/storage/`.
- [x] Fix mypy errors in `app/services/` and `app/api/`.
- [x] Add `backend/scripts/check.sh` running lint, format check, mypy, and tests in one
      command.
- [x] Confirm `backend/.env.example` matches every field in `Settings` (added
      `AUTOPROFILEML_JOB_RETENTION_SECONDS`, stripped its BOM).
- [x] Commit Phase 1. *(Committed as `d76229a` on `main`.)*

**Verification**

```bash
cd backend
bash scripts/check.sh            # runs all four checks below
ruff check .                     # 0 errors
ruff format --check .            # clean (no panic)
mypy app                         # Success: no issues found
pytest -q                        # 39 passed, including the failed-reprofile regression
# empty upload → 400; oversized upload → 413
git status --short               # no data/, .venv/, caches staged
```

---

## Phase 2 — Frontend Scaffold

**Goal:** A running Next.js 16 App Router app with Tailwind v4, shadcn/ui, strict
TypeScript, and a test runner.

- [x] Scaffold with
      `npx create-next-app@16.4.2 frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --turbopack`
      (run from the repo root; the existing empty `frontend/` is safe). Added
      `--no-react-compiler` to keep the scaffold free of the React Compiler.
- [x] Verify `package.json` pins Next `16.4.2`, React `19.3.1`, TypeScript `7.0.2`, Tailwind
      `4.3.3`; pin any ranges that resolved differently.
      - The scaffold resolved React `19.3.0` and left TypeScript/Tailwind ranged; everything
        is now pinned exactly. `@types/node` is pinned to `22.x` (vitest 5 peer range).
      - **TypeScript 7 ships no compiler API**, which `typescript-eslint` requires. Following
        the TypeScript 7 release notes, TS is installed side-by-side: `@typescript/native`
        (alias of `typescript@7.0.2`) provides the `tsc` binary, and `typescript` (alias of
        `@typescript/typescript6`) provides the 6.0 API that `eslint-config-next` loads.
        Without this, `npm run lint` throws before linting anything.
- [x] Enable strict compiler options in `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`,
      `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- [x] Add runtime dependencies: `@tanstack/react-query@5.104.4`, `zod@4.6.7`,
      `recharts@3.10.1`, `react-dropzone@20.1.4`, `sonner@2.0.8`,
      `react-hook-form@7.90.0`, `@hookform/resolvers@5.9.2`, `lucide-react@1.59.0`.
- [x] Initialize shadcn: `npx shadcn@4.22.0 init` (CSS variables, Tailwind v4, neutral base).
- [x] Add shadcn primitives: `button card input label table badge tabs dialog
      alert-dialog dropdown-menu progress separator skeleton alert select checkbox form
      tooltip scroll-area sheet sonner`.
      - The `base-nova` style (Base UI) has no `form` primitive; its registry entry is
        fileless. Added `field` instead — Base UI's `Field`/`FieldLabel`/`FieldError` set is
        the supported way to build labelled, validated form controls in this style.
- [x] Replace the scaffold page with an app shell: header, product name, navigation
      (Datasets), `<Toaster />`, and a neutral content container.
- [x] Add `src/app/providers.tsx` with a client-side `QueryClientProvider` (no devtools in
      production). It also hosts `ThemeProvider` (required by the vendored sonner wrapper)
      and `TooltipProvider`.
- [x] Add `.env.local.example` with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` and a
      documented `NEXT_PUBLIC_*`-only rule. Negated `frontend/.gitignore` so it is committable.
- [x] Install dev dependencies: `vitest@5.0.5`, `@testing-library/react@16.3.3`,
      `@testing-library/jest-dom`, `jsdom@30.1.3`, `msw@3.0.3`, `@vitejs/plugin-react@6.1.2`.
- [x] Add `vitest.config.mts`, `src/test/setup.ts`, and `npm run typecheck` / `npm test`
      scripts.
- [x] Add one smoke test rendering the app shell and asserting the product name.
- [x] Run the app and confirm Tailwind/shadcn styles render.
- [x] Commit Phase 2. *(Committed as `304f687` on `main`.)*

**Verification**

```bash
cd frontend
npm run dev          # http://localhost:3000 renders the shell (/ and /datasets → 200)
npm run lint         # 0 errors
npm run typecheck    # 0 errors
npm test             # 1 smoke test passes
npm run build        # production build succeeds (/, /datasets prerendered)
```

---

## Phase 3 — API Contract & Data Layer

**Goal:** A typed, tested boundary between the frontend and FastAPI.

- [x] Create `src/types/api.ts` with every existing backend model (DatasetSummary,
      ProfileReport, ColumnProfile, TopValue, CollinearityFinding, ProfilingWarning,
      JobRecord, DatasetUploadResponse, DatasetListItem).
- [x] Create Zod schemas in `src/lib/api/schemas.ts` for the same models (dates stay strings).
      Each schema is annotated `z.ZodType<MirrorType>`, so a backend field change fails
      `tsc` instead of drifting silently.
- [x] Implement `src/lib/api/client.ts`: base URL from env, `apiFetch(path, schema, init)`,
      `ApiError { status, detail }`, `cache: "no-store"`.
      - Adds `requestId` (read from `x-request-id`) and normalizes 422 validation bodies into
        one displayable `detail` string.
- [x] Implement `src/lib/api/endpoints.ts` functions: `listDatasets`, `getDataset`,
      `getProfile`, `uploadDataset` (FormData; do not set `Content-Type` manually),
      `reprofileDataset`, `getJob`, `listDatasetJobs`.
- [x] Add `deleteDataset` once the backend endpoint from Phase 4 exists (leave a TODO until
      then). *(TODO left in `endpoints.ts`.)*
- [x] Define centralized `queryKeys` in `src/lib/api/query-keys.ts`.
- [x] Implement `useJob(jobId)` with terminal-aware `refetchInterval` (2000 ms).
- [x] Implement `useDatasets`, `useDataset`, `useProfile`, `useUploadDataset`, and
      `useReprofileDataset` hooks.
      - `useProfile` does not retry a `409`, which only means profiling is still running.
- [x] Add `src/lib/format.ts`: bytes, percentages, counts, ISO dates, durations, and
      task-metric formatting, with unit tests.
- [x] Add MSW handlers for: dataset list, upload success, profile success, job progression,
      and API error envelopes.
      - MSW 3.0.3 renamed the listen option to `onUnhandledFrame`; the setup uses that name.
- [x] Test `apiFetch` maps non-2xx `detail` to `ApiError` and rejects malformed JSON.
- [x] Test `useJob` stops polling after `succeeded`/`failed` (fake timers).
      - Fake timers drive the 2 s interval; `vi.waitFor` flushes React's notification batch
        before the status assertion.
- [x] Commit Phase 3. *(Committed as `d54a132` on `main`.)*

**Verification**

```bash
cd frontend
npm run typecheck    # 0 errors
npm test             # 25 tests pass: client, polling, formatting, shell
```

Contract check: the live backend's `/openapi.json` was compared with the mirror types —
every model exposes exactly the fields declared in `src/types/api.ts`.

Manual: with the backend running, open a page using `useDatasets` and confirm the request
appears in the Network tab and the devtools query cache populates. *(Deferred to Phase 4,
which adds the first page that consumes these hooks.)*

---

## Phase 4 — Dataset Library, Upload & Deletion

**Goal:** A user can upload a dataset, watch profiling, reopen it, re-profile it, and delete
it.

### Backend

- [x] Extend the `Storage` contract with `delete_tree(path)` and implement it with
      `shutil.rmtree` in `LocalStorage` (guard against deleting outside `storage_root`).
      - The guard resolves both paths and refuses the storage root itself or anything outside
        it.
- [x] Add `DatasetService.delete_dataset(dataset_id)`: remove the dataset directory, its
      profile JSON, and (later) its benchmark directory; raise `DatasetNotFoundError` when
      absent.
      - The profile is deleted before the directory so a partial failure cannot leave a
        profile pointing at a missing dataset.
- [x] Add `DELETE /api/datasets/{dataset_id}` returning `204` and mapping unknown IDs to
      `404`.
- [x] Add API + service tests for deletion (204, 404, profile gone, listing empty).
      - Also covers the storage-root guard and a no-op delete of a missing tree.
- [x] Register the delete route in the OpenAPI surface and update [ARCHITECTURE.md](ARCHITECTURE.md).
      - FastAPI publishes it automatically; the endpoint table and known-limitations entry
        were updated.

### Frontend

- [x] Create `/datasets` page as a Server Component fetching the dataset list with
      `cache: "no-store"`.
- [x] Build `DatasetCard`/`DatasetTable` showing filename, format, size, shape, profile
      availability, latest job status, and upload time.
- [x] Add empty state with an upload call-to-action and `loading.tsx` skeleton.
- [x] Build `UploadDropzone` with react-dropzone: accept `.csv/.parquet/.pq`, reject other
      types and files > 200 MB client-side with an inline message.
      - The limit comes from `NEXT_PUBLIC_MAX_UPLOAD_MB` (default 200) rather than a literal,
        so it can be kept equal to the backend's `AUTOPROFILEML_MAX_UPLOAD_MB`.
- [x] Implement the upload mutation, disable the button while pending, and show an
      indeterminate upload state (no byte-level progress).
- [x] On upload success, toast the created dataset and navigate to `/datasets/{id}`.
      - Phase 5 owns the full dashboard, so Phase 4 adds a minimal landing page (filename,
        format, size, shape, upload time, back link). Phase 5 replaces it.
- [x] Render backend upload errors (`413`, `415`, `422`) verbatim from `detail`.
- [x] Add delete action with an `AlertDialog` confirmation; invalidate the list on success.
      - The list is server-rendered, so the dialog also calls `router.refresh()`; query
        invalidation covers the client-cache entries for the deleted dataset.
- [x] Add `error.tsx` for the datasets segment with a retry button.
- [x] Test the dropzone (valid/invalid/oversized) and the delete confirmation flow.
- [x] Commit Phase 4. *(Committed as `5437a39` on `main`.)*

**Verification**

```bash
cd backend && bash scripts/check.sh    # 43 tests pass; lint/format/mypy clean
cd ../frontend
npm run lint                           # 0 errors
npm run typecheck                      # 0 errors
npm test                               # 31 tests pass
npm run build                          # / and /datasets/[datasetId] partially prerendered
```

End-to-end (both servers running): a scratch CSV uploaded through the API returns `202`,
`GET /datasets` renders the row (filename, shape, `succeeded`, `Available`), the detail page
renders `10 rows × 4 columns`, `DELETE` returns `204`, a repeat delete returns `404`, the list
returns `[]`, and the dataset/profile files are gone from the storage root.

Manual: dragging a file onto the dropzone and confirming the delete dialog are covered by the
component tests; the surrounding data flow was exercised end-to-end through the rendered pages
above.

---

## Phase 5 — Profile Dashboard

**Goal:** Every profile statistic and warning is visible, navigable, and understandable.

### Backend (correlation matrix support)

- [x] Add `CorrelationMatrix { features: list[str], values: list[list[float]] }` to
      `schemas.py` and an optional `correlation: CorrelationMatrix | None` on `ProfileReport`.
- [x] Compute the Pearson matrix once in `profiling.py` for numeric features (≤ 40), reuse
      it for VIF where practical, and round values to 4 decimals.
      - `profile_frame` builds one complete-case matrix and passes it to both `compute_vif`
        and the correlation report, so the two checks cannot disagree.
- [x] Return `null` when fewer than two numeric features exist; add unit tests.
      - Also returns `null` above the 40-feature cap, matching the VIF bound.
- [x] Mirror the new model in `src/types/api.ts` and its Zod schema.

### Frontend

- [x] Create `/datasets/[datasetId]/page.tsx` as a Server Component fetching the dataset;
      render a not-found state for 404.
- [x] Build `DatasetHeader` with filename, shape, size, upload time, and actions
      (re-profile, delete, benchmark placeholder).
- [x] Build `JobProgress`: polls non-terminal jobs, shows stage label + percentage, stops at
      terminal status, and surfaces `error`.
      - On a terminal status the client calls `router.refresh()`; the profile is never fetched
        by a client hook, so server data has one hydration path.
- [x] When no profile exists and no job is active, show "Profile not available" with a
      run/re-run action.
- [x] Build `ProfileOverview` KPI cards: rows, columns, memory, duplicates, numeric count,
      categorical count, profile duration.
- [x] Build `WarningsPanel`: group by severity, show code/column/message, collapsible.
      - Uses native `<details>` so collapsing works without extra client state.
- [x] Build `ColumnTable`: sortable columns (name, dtype, missing %, unique, constant),
      text search, and a semantic-type filter.
- [x] Build `ColumnDetail` (dialog/sheet): dtype, semantic type, nulls, uniques, all numeric
      statistics, and skew/kurtosis.
- [x] Add `TopValuesChart` (horizontal bar) for categorical/boolean columns with an
      accessible table fallback.
      - Recharts bars use the validated viz tokens; the table twin is always available.
- [x] Add `QuartileChart` (box-style range) for numeric columns.
- [x] Add `MissingnessBar` reused in the table and detail views.
- [x] Build `CollinearityPanel`: VIF values, severity badges, correlated-with feature.
- [x] Build `CorrelationHeatmap`: CSS grid/SVG, diverging color scale, hover tooltip, and a
      keyboard/table fallback for accessibility.
      - Implemented as a semantic `<table>` with colored cells (the table *is* the
        keyboard/screen-reader twin), native `title` tooltips, visible diverging legend, and
        sr-only cell values.
- [x] Add `loading.tsx`, `error.tsx`, and an empty-profile state for the dataset segment.
- [x] Wire the re-profile mutation with toast feedback and query invalidation.
- [x] Test the column table filtering/sorting and the warning grouping.
- [x] Commit Phase 5. *(Committed as `d535e50` on `main`.)*

**Verification**

```bash
cd backend && bash scripts/check.sh     # 46 tests pass; lint/format/mypy clean
cd ../frontend
npm run lint                            # 0 errors
npm run typecheck                       # 0 errors
npm test                                # 37 tests pass
npm run build                           # /datasets/[datasetId] partially prerendered
```

End-to-end with both servers running: a scratch CSV profiled successfully, the profile JSON
returned a 3×3 correlation matrix (`age ↔ income = 0.9948`) and a critical
`multicollinearity` warning, and the rendered dashboard contained the Overview, Warnings,
Columns, Collinearity, and Correlation sections with the expected values, heatmap aria labels,
and actions (Re-profile, disabled Benchmark, Delete). The scratch dataset was deleted
afterwards, leaving the storage root empty.

Manual interaction notes: the heatmap tooltip is the cell's native `title`, and every value is
also in the table for keyboard/screen-reader users. Re-profile is wired through the mutation
plus `router.refresh()`; the endpoint's job lifecycle is covered by `test_reprofiling_creates_new_job`.

---

## Phase 6 — Preprocessing Engine (Backend)

**Goal:** A leakage-free, inspectable preprocessing plan for a chosen target.

- [x] Add `scikit-learn>=1.9.1` to backend dependencies and install (`pip install -e ".[dev]"`).
      - `joblib>=1.6.0` is declared explicitly too; the picklability test uses it, and the
        benchmark arena needs it in Phase 7.
- [x] Create `app/models/benchmark.py` with `TaskType`, `BenchmarkCreateRequest`,
      `PreprocessingStep`, `PreprocessingPlan`, and placeholder response models.
      - Also defines `FeaturePartition` and the Phase 7 `ModelResult`/`BenchmarkRun` shapes.
- [x] Implement `services/preprocessing.py::detect_task(target_profile, row_count,
      override) -> (TaskType, reason)` with the rules in ARCHITECTURE §5.1.
- [x] Add unit tests for task detection: boolean/string targets, low-cardinality numeric,
      continuous numeric, explicit override, all-null/constant rejection.
- [x] Implement `partition_features(frame, target, excluded, profile) -> FeaturePartition`
      separating numeric, low-cardinality categorical, high-cardinality categorical,
      dropped constants, and dropped all-null columns.
      - Temporal/unknown semantic types are dropped as unsupported and documented in
        ARCHITECTURE §5.2.
- [x] Add tests for partitioning and exclusion of the target.
- [x] Implement `IQRClipper(BaseEstimator, TransformerMixin)` computing bounds on `fit` and
      clipping on `transform`, preserving NaNs.
- [x] Add tests proving clipping bounds come only from `fit` data.
- [x] Implement `AdaptiveNumericImputer` (a picklable sklearn transformer) that chooses
      between `SimpleImputer(strategy="median")` and `KNNImputer(n_neighbors=5)` at `fit`
      time: KNN only when the fit fold is ≤ `KNN_MAX_ROWS` (20,000) and 5% ≤ missing rate ≤
      50%; otherwise median. The decision is recorded so the plan can show which strategy ran.
- [x] Add tests for the imputer's strategy decision (small + complex → KNN; large → median;
      low/high missingness → median) and for reproducibility with a fixed seed.
- [x] Implement `build_preprocessor(partition, task) -> ColumnTransformer` with adaptive
      numeric imputation, `IQRClipper`, one-hot for low-cardinality, and `TargetEncoder` for
      high-cardinality columns; categorical fields use mode imputation (the field's constant
      or most frequent value).
      - `scale_numeric=True` adds `StandardScaler` for linear models, matching §5.2.
      - `TargetEncoder` takes a shuffled `KFold`/`StratifiedKFold(cv=5, seed 42)`; sklearn 1.9
        deprecates passing `random_state` without a splitter.
- [x] Add tests for unseen categories (`handle_unknown="ignore"`) and target encoding.
- [x] Implement `describe_preprocessor(fitted, partition) -> PreprocessingPlan` so the UI can
      display exactly what ran.
- [x] Add a leakage regression test: fit on a training fold, transform a held-out fold whose
      target values are radically different, and assert encodings are unchanged (train-only
      statistics).
- [x] Add a picklability test (joblib round-trip) for the full pipeline.
- [x] Commit Phase 6. *(Committed as `e6238ef` on `main`.)*

**Verification**

```bash
cd backend && bash scripts/check.sh
pytest tests/test_preprocessing.py -q   # 25 passed
pytest -q                               # 71 passed overall
```

Manual sanity: a 300-row scratch frame with a binary `churn` target produced
`classification`, partitioned `age`/`income` as numeric, `city` as low-cardinality, dropped the
constant column, and described: KNN imputation (5% missing → within the band), IQR clipping,
mode imputation, one-hot encoding, and a drop step with 1 constant column. The plan matches
ARCHITECTURE §5.2.

Note: scikit-learn 1.9.1 ships no `py.typed` marker in this environment, so `pyproject.toml`
ignores its missing imports and allows subclassing its base classes in
`app.services.preprocessing` only. All other modules remain fully strict.

---

## Phase 7 — Benchmark Arena (Backend)

**Goal:** Four models, five-fold CV, metrified and ranked, persisted, with per-model failure
isolation.

- [x] Extend `JobRecord.kind` to accept `"explanation"` and `"export"` (Literal + TS mirror).
- [x] Define metric helpers for classification (accuracy, macro F1, ROC-AUC binary/OvR
      weighted, log loss) and regression (RMSE, MAE, R²).
- [x] Add unit tests for each metric on known arrays (including multiclass ROC-AUC).
- [x] Build the model registry (`services/benchmarking.py`) with linear, random forest,
      LightGBM, and XGBoost factories for both task types, fixed `random_state=42`.
- [x] Add `lightgbm>=4.7.0`, `xgboost>=3.4.1`, and `joblib>=1.6.0` dependencies and install.
- [x] Implement `cross_validate_model(pipeline, X, y, task, folds) -> ModelResult` using
      `StratifiedKFold`/`KFold` and `cross_validate`, storing mean + std metrics.
- [x] Catch per-model exceptions and produce a `status="failed"` `ModelResult` with a
      sanitized error; add a test with a deliberately failing estimator.
- [x] Implement ranking: sort succeeded models by primary metric, assign dense ranks, and set
      `best_model_id`.
- [x] Implement sampling above 250,000 rows with seed 42; set `sample_rows` and a warning.
- [x] Implement `BenchmarkService.enqueue(dataset_id, request)` validating the dataset, target,
      folds, and exclusions; create the job and `BenchmarkRun` document.
- [x] Implement `BenchmarkService.run_benchmark(benchmark_id, job_id)` with progress stages and
      JSON persistence under `data/benchmarks/{benchmark_id}/run.json`. Models run
      sequentially in the documented fixed order (ADR-9); update the job stage to
      `training (2/4): Random Forest`-style labels so sequential runs still show progress.
- [x] During the cross-validated pass, retain each fold's test-set predictions (out-of-fold
      predictions) per succeeded model; persist them under
      `data/benchmarks/{benchmark_id}/predictions/{model_id}.json` (row index, true label,
      predicted label/probabilities), capped to a documented row count.
- [x] Compute per-class support for classification runs and store it on `BenchmarkRun`.
- [x] Add a test that out-of-fold predictions exist for every succeeded classification model
      and that support sums to the CV row count.
- [x] After ranking, refit each succeeded pipeline on the full/sampled dataset and persist it
      with joblib to `data/benchmarks/{benchmark_id}/models/{model_id}.joblib`; record
      refit failures as `ModelResult.status="failed"`.
- [x] Add a test that served model IDs resolve to persisted joblib files and that crafted IDs
      cannot escape the benchmark directory.
- [x] Implement atomic JSON writes (temp file + `Path.replace`) in `LocalStorage`.
- [x] Implement `list_benchmarks(dataset_id)` and `get_benchmark(benchmark_id)`.
- [x] Add routes: `POST /api/datasets/{id}/benchmarks` (202),
      `GET /api/datasets/{id}/benchmarks`, `GET /api/benchmarks/{id}` (404/409 handling), and
      `GET /api/benchmarks/{id}/models/{model_id}/predictions` (404 when absent, 400 for a
      regression run).
- [x] Wire `BenchmarkService` via `app/api/deps.py` and register the router.
- [x] Extend dataset deletion to remove `data/benchmarks/*` for that dataset.
- [x] Add API integration tests: enqueue → poll → leaderboard persisted → history listed;
      unknown dataset → 404; invalid target → 400.
- [x] Add a test that a completed run is readable after constructing a fresh service instance
      (restart simulation).
- [x] Commit Phase 7.

**Notes**

- Committed as `8cb16d4`.
- Classification pipelines wrap the estimator in `LabelEncodedClassifier` (an sklearn
  `BaseEstimator`/`ClassifierMixin`) because XGBoost rejects string class labels. The wrapper
  fits a `LabelEncoder` per fold, decodes `predict`, and passes `predict_proba` through, so
  metrics and out-of-fold rows keep the original labels.
- Metrics are module-level functions exposed to `make_scorer`; `log_loss`, `rmse`, and `mae`
  are negated by sklearn's scorer convention and re-negated when stored.
- Out-of-fold rows are extracted from the estimators returned by
  `cross_validate(..., return_estimator=True)` with the explicitly recorded fold splits,
  sorted by row index, and capped at `PREDICTION_CAP = 20_000`.
- `scikit-learn` and `joblib` ship no `py.typed` marker here, so `pyproject.toml` ignores
  their missing imports and permits subclassing their base classes in
  `app/services/preprocessing.py` and `app/services/benchmarking.py` only.
- A `joblib` artifact is only written by the benchmark service; read paths validate
  `benchmark_id`/`model_id` against `^[0-9a-f]{32}$` and the run's leaderboard before
  resolving a path.

**Verification**

```bash
cd backend
pytest tests/test_benchmarking.py tests/test_api_benchmarks.py -q   # 17 passed
pytest -q                                                            # 88 passed
```

Manual API walk (temporary storage root, 300-row frame with a 4-class `city` target, 5 folds):
queued benchmark, polled the job through `training (4/4): XGBoost`, and read back the run:
4 leaderboard entries, ranks 1–4, LightGBM best (macro F1 0.3265, accuracy 0.3400),
`class_support` summing to 300, a persisted preprocessing plan, and 300 decoded out-of-fold
predictions with class probabilities. Historical listing returned the run as `succeeded`.

---

## Phase 8 — Explainability (Backend)

**Goal:** SHAP global importance and per-row contributions for a chosen model, as a separate
job.

- [x] Add `shap>=0.54.1` to backend dependencies and install.
- [x] Load the persisted `models/{model_id}.joblib` pipeline for the benchmark, validating
      that the model ID is in the run's leaderboard and the resolved path stays inside the
      benchmark directory.
- [x] Create `app/models/explanation.py` with `FeatureImportance`, `ShapContribution`,
      `LocalExplanation`, `ShapSummaryPoint`, `ExplanationReport`, and
      `ExplanationCreateRequest`.
- [x] Add `ShapSummaryPoint { feature, feature_value, shap_value }` and
      `summary_points: list[ShapSummaryPoint]` to `ExplanationReport` so the UI can render a
      beeswarm.
- [x] Implement explainer selection: `TreeExplainer` for RF/LightGBM/XGBoost,
      `LinearExplainer` for linear models; reject unsupported families with `400`.
- [x] Implement fixed-seed sampling (≤ 1,000 rows) and a bounded background set.
- [x] Compute global mean-|SHAP| importance, rank features, and cap the displayed list.
- [x] Compute per-row contributions for N requested rows, sorted by absolute value and capped
      at 15 features.
- [x] Build `summary_points` for the top 10 features over the sample (rounded to 6 decimals).
- [x] Implement `ExplanationService.enqueue(benchmark_id, request)` and
      `run_explanation(explanation_id, job_id)` with job stages/progress and JSON persistence
      under `data/benchmarks/{benchmark_id}/explanations/{model_id}.json`.
- [x] Add routes: `POST /api/benchmarks/{id}/explanations` (202) and
      `GET /api/benchmarks/{id}/explanations/{model_id}` (200/404/409).
- [x] Extend dataset deletion and benchmark deletion to remove explanations and persisted
      models.
- [x] Add tests with a small RandomForest: report shape, finite values, global ranking,
      local contribution count, persistence, and unknown model → 404.
- [x] Commit Phase 8.

**Notes**

- Committed as `1180aa7`.
- SHAP is fit inside the service, never passed through the preprocessing fold machinery: the
  persisted pipeline is loaded and explained as a whole, so the encoded feature space matches
  what the model actually saw. Additivity checks are disabled for interventional tree SHAP
  because float noise makes the assertion fire on probabilities.
- `LabelEncodedClassifier` is unwrapped before building an explainer; encoded classes and
  probabilities align with the wrapper's sorted classes, so per-row explanations use the
  predicted class consistently.
- Feature names cannot come from `ColumnTransformer.get_feature_names_out()` because the
  adaptive numeric imputer does not implement it. They are reconstructed per transformer:
  numeric and target-encoded columns keep their names, one-hot columns use the fitted
  encoder's category names.
- Global importance averages |SHAP| over samples and classes; local explanations report the
  predicted class (classification) or the regression output. All values are rounded to 6
  decimals, coerced finite, and stored as JSON (`ExplanationReport`), never raw arrays.
- Unsupported families raise `UnsupportedModelError` → `400`; all four registry families are
  covered, so `kernel_shap` stays reserved in the `method` literal.
- A benchmark re-run deletes `models/`, `predictions/`, and `explanations/` before training so
  artifacts from a previous attempt can never be served. Dataset deletion removes the whole
  benchmark tree, which includes explanations.
- `shap` pulls in `pandas` as a transitive dependency; no project code imports it, and the
  Polars-only rule is unchanged.

**Verification**

```bash
cd backend
pytest tests/test_explainability.py -q   # 8 passed
pytest -q                                # 96 passed
```

Manual API walk (temporary storage root, 400-row frame, 5 folds, four models): queued a
benchmark, polled to completion, POSTed an explanation for the best model (Logistic
Regression, `linear_shap`), and read back the report — 300 sampled rows, 100-row background,
3 ranked finite non-negative importances, 900 summary points (bounded to 10 × sample), 8 local
explanations with prediction, base value, and signed contributions, plus a persisted report in
21.9 ms. All four families were separately smoke-tested through `build_report` (linear, random
forest, LightGBM, XGBoost) on a multiclass target.

---

## Phase 9 — Benchmark & Explanation UI

**Goal:** A user can choose a target, run a benchmark, read the leaderboard, and inspect SHAP
output entirely in the browser.

- [x] Add benchmark and explanation models + Zod schemas to `src/types/api.ts` /
      `src/lib/api/schemas.ts`.
- [x] Add endpoint functions: `createBenchmark`, `listBenchmarks`, `getBenchmark`,
      `getPredictions`, `createExplanation`, `getExplanation`.
- [x] Add query keys and hooks (`useBenchmarks`, `useBenchmark`, `useCreateBenchmark`,
      `useExplanation`).
- [x] Build `BenchmarkForm`: target select from profile columns, "auto-detect" task type with
      an override select, excluded-feature multi-select, folds (3–10), and client-side
      validation with Zod + react-hook-form.
- [x] Show the dataset's constant/target-like columns as recommended exclusions.
- [x] Implement the create mutation, navigate to the benchmark page, and toast errors.
- [x] Create `/benchmarks/[benchmarkId]/page.tsx` with a Server Component initial fetch.
- [x] Build `BenchmarkProgress` polling the job with stage/progress and terminal handling.
- [x] Build `PreprocessingPlanPanel`: feature groups, encodings, imputation, clipping, drops,
      and notes.
- [x] Build `LeaderboardTable`: rank, model, primary + secondary metrics, metric std, training
      time, failed status/error, sortable by metric.
- [x] Build `ConfusionMatrixView`: per model, classes as rows (true) and columns (predicted),
      absolute counts with a normalized color scale, hover tooltip showing counts and percentage
      of the row, and a text table fallback for screen readers.
- [x] Build `RocCurveChart` (classification only): plot per-class ROC curves plus macro average
      from stored out-of-fold predicted probabilities, show the AUC legend, and include a
      text summary of each AUC. Show an explanatory empty state when probabilities are
      unavailable (for example a failed model).
- [x] Add a "wrong predictions" table for the selected model: the highest-confidence mistakes
      from the out-of-fold predictions with true and predicted labels.
- [x] Add `MetricBarChart` comparing succeeded models on the primary metric with an accessible
      table fallback.
- [x] Add a run-history section on the dataset page with links to each benchmark.
- [x] Add "Explain best model" action with a model selector and sample-size control.
- [x] Build `GlobalImportanceChart` (horizontal bars, top 15).
- [x] Build `ShapBeeswarm`: custom SVG scatter with per-feature jitter, color by feature value,
      tooltip, and a table fallback.
- [x] Build `LocalExplanationInspector`: row selector, prediction/base value, signed
      contribution bars, and the original feature values.
- [x] Add loading/error/empty/not-found states for both segments.
- [x] Test the leaderboard ranking render, failed-model rendering, and explanation empty
      state.
- [x] Commit Phase 9.

**Notes**

- Committed as `9288a33`.
- The data layer mirrors every backend contract again: `BenchmarkRun`, `ModelResult`,
  `PreprocessingPlan`, `OutOfFoldPredictions`, `ExplanationReport`, and their request types
  are in `types/api.ts` with matching Zod schemas, endpoint functions, query keys, and hooks.
- Server Components own initial fetches (dataset page, benchmark page); client leaves are
  limited to the form, sortable leaderboard, model diagnostics, job polling, and the
  explanation panel.
- The benchmark create response carries the job id; the form navigates to
  `/benchmarks/{id}?job={jobId}` so `BenchmarkProgress` can poll with stage/progress and
  `router.refresh()` when the job settles. A reload without the query parameter shows a
  refresh affordance instead of guessing a job id.
- Recommended exclusions come from profiling: constant columns, severe collinearity findings,
  and categorical/boolean columns whose distinct count is ≥95% of the row count. The target
  column is never included, and a "Select recommended" action checks them all.
- Chart colors use validated tokens: `--viz-series-1…5` were checked with the dataviz palette
  validator in both modes (adjacent-pair CVD ΔE 9.1 light / 8.4 dark; the light-mode contrast
  warning is relieved by the always-present legend and table fallbacks). The ROC chart caps
  displayed classes at four plus the macro average.
- Confusion-matrix cells encode the row-normalized share with a single blue ramp, carry the
  count and percentage, and tooltip the percentage; the beeswarm normalizes feature values
  per feature and uses deterministic jitter with a `<title>` tooltip and table fallback.
- Out-of-fold predictions are fetched per selected model and only for classification. A
  regression run shows an explicit classification-only empty state; missing probabilities
  produce an explanatory ROC empty state.
- MSW handlers and fixtures grew to cover benchmarks, predictions, and explanations; jsdom
  got a ResizeObserver stub for Recharts. Frontend tests: 46.

**Verification**

```bash
cd frontend
npm run typecheck && npm run lint && npm test && npm run build   # 46 tests, build clean
```

Manual end-to-end against a real backend on a temporary storage root (300-row frame with
`city`, `age`, `income`, a duplicated `income_copy`, and `constant_col`): the dataset page
rendered the benchmark form with "recommended: constant value" and "recommended: highly
collinear with income"; the 5-fold classification run showed four ranked models (best badge,
macro-F1 primary column, failure isolation) and the preprocessing plan; a SHAP job produced
a persisted report (3 features, 600 beeswarm points, 8 local rows); the regression run on
`income` showed RMSE/MAE/R² and the classification-only diagnostics/ROC empty state. Client
interactions (form validation and navigation, leaderboard sorting, explanation empty state)
are covered by the component tests.

---

## Phase 10 — Hardening & MVP Release

**Goal:** Remove known debt, make failure modes safe, and prove the release checklist.

- [x] Replace deprecated `@app.on_event("startup")` with a `lifespan` context manager; assert
      no deprecation warning in tests.
- [x] Add storage-root containment tests: deleting a crafted ID cannot escape `data/`.
- [x] Add an upload test with a traversal filename (`../../etc/passwd`) confirming it is
      stored as a basename.
- [x] Add an empty-CSV and a zero-column dataset test (clear failed job, no 500).
- [x] Add a benchmark cancellation/timeout guard or document the absence explicitly in
      ARCHITECTURE limitations.
- [x] Verify `mypy app` passes after all phases; add missing annotations.
- [x] Verify `ruff check .`, `ruff format --check .`, and the full backend suite pass.
- [x] Verify `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- [x] Add a root `README.md` with prerequisites, install, run, test, and troubleshooting
      commands (mirroring CLAUDE.md but user-facing).
- [x] Run the PRD §4.3 release checklist manually on a clean `data/` directory and record the
      result.
- [x] Smoke-test in a fresh browser profile: upload → profile → benchmark → explain → reload.
- [x] Update all PLAN.md checkboxes and reconcile any contract drift in ARCHITECTURE.md.
- [x] Commit the MVP and tag it (`v0.1.0`).

**Notes**

- Committed as `fdc7dcd` and tagged `v0.1.0`.
- `create_app` now passes a `lifespan` context manager to FastAPI. `pyproject.toml` turns any
  `on_event` deprecation into a test error, and a test asserts the app registers no legacy
  startup/shutdown handlers.
- Dataset ids are validated at the service boundary (`^[A-Za-z0-9_-]{1,128}$`) before any
  path is built, so a crafted id such as `../../escape` is a clean 404 and never reaches the
  filesystem. `LocalStorage.delete_tree` also refuses any target outside the storage root.
- The hardening suite covers: crafted delete id (API and service), delete-tree containment,
  traversal upload filename stored as `passwd.csv`, empty upload → 400 with prior datasets
  intact, zero-column CSV → 202 then a failed job with `Could not profile ...`, and a valid
  upload still profiling.
- Benchmark/explanation cancellation and timeouts are documented as absent in
  ARCHITECTURE §9 rather than implemented; the same section now records the sampling caps,
  single-process constraint, and trusted-artifact rule.
- The visual release pass caught two chart issues that were fixed: the ROC legend collided
  with the x-axis label (replaced with an HTML AUC legend below the chart), and Recharts'
  mount animation could capture bars at zero width (bars now render without animation).
- Frontend totals at release: 46 tests; backend 103 tests.

**Verification**

```bash
cd backend && source .venv/Scripts/activate
ruff check . && ruff format --check . && mypy app && pytest -q   # 103 passed
cd ../frontend
npm run lint && npm run typecheck && npm test && npm run build    # 46 passed, build clean
```

Release checklist (PRD §4.3) executed in a **fresh headless Chrome profile** against a clean
temporary storage root, driving the real UI over CDP (the repository `data/` directory holds
prior user uploads, so it was not deleted):

1. Uploaded `release.csv` through the dropzone → navigated to the dataset page.
2. Profiling rendered warnings and the correlation section.
3. Selected `city`, ran a 5-fold benchmark, and read the leaderboard: all four models, ranks,
   best badge, confusion matrix, ROC curves (AUC legend), and mistakes table.
4. Ran SHAP for the best model; global bars, beeswarm, and per-row contributions rendered.
5. Reloaded the benchmark page; the leaderboard and explanation persisted.
6. An empty upload returned 400 with a clear reason and an invalid benchmark target returned
   400, while the existing dataset and benchmark history remained intact.

Zero JavaScript exceptions were recorded across the run; screenshots were inspected for label
collisions and chart geometry.

---

## Phase 11 — P1 (Post-MVP, Optional)

**Goal:** Deliver exportability and operational niceties only after the MVP is stable. Do not
start this phase until Phase 10 is verified and tagged.

- [x] Feasibility spike: verify `skl2onnx` support for the chosen LightGBM/XGBoost pipeline and
      `TargetEncoder`; record the conclusion in ARCHITECTURE.md.
- [x] Implement script generation from `PreprocessingPlan` + fitted pipeline, with comments
      and imports; generate it with sklearn `Pipeline`/`ColumnTransformer` builders and verify
      the result with `ast.parse` (do not build source by unparsing arbitrary ASTs).
- [x] Implement notebook generation mirroring the script with markdown sections.
- [x] Serialize the fitted pipeline with joblib into the artifact directory.
- [x] Bundle script + notebook + pipeline (+ ONNX if verified) into a ZIP.
- [x] Add `POST /api/benchmarks/{id}/export` (job) and
      `GET /api/benchmarks/{id}/export/download`.
- [x] Add export UI with job progress and a download link.
- [x] Add tests that the generated script is syntactically valid (`ast.parse`) and references
      the actual target/features.
- [x] Add optional row-sampling controls for benchmarks.
- [x] Add benchmark comparison view (if time permits).
- [x] Update PRD P1 statuses and ARCHITECTURE contracts.
- [x] Commit P1.

**Notes**

- Committed as `eaa9e71`; the comparison view followed in `45e43f7`.
- Feasibility spike result: skl2onnx 1.20.0 + onnxruntime 1.31.1 were installed temporarily.
  A plain sklearn pipeline converts, but a project pipeline fails with
  `MissingShapeCalculator` for `AdaptiveNumericImputer`; `IQRClipper` and
  `LabelEncodedClassifier` have no registered converters either. ONNX is therefore not
  shipped; the packages were uninstalled and the conclusion is recorded in ARCHITECTURE §5.5
  and the export manifest's `onnx_note`.
- Routes were implemented as a per-model collection to match the explanation API:
  `POST /api/benchmarks/{id}/exports`, `GET .../exports/{model_id}` (manifest), and
  `GET .../exports/{model_id}/download`. The singular `/export` path in the original plan was
  superseded; ARCHITECTURE and README reflect the shipped routes.
- The generator re-derives the preprocessing plan from the chosen model's own persisted
  pipeline, so exporting a non-best model works. Estimator references come from a fixed
  family × task allow-list; run-supplied values are embedded only as `repr()`-escaped
  literals. Generated Python is validated with `ast.parse` before packaging; the notebook is
  reparsed as JSON. The backend never executes generated code.
- Bundles are idempotent per model: `data/artifacts/{benchmark_id}/{model_id}.zip` plus a
  manifest JSON. Writes are atomic (binary writes gained the same temp-file + replace path as
  text). Dataset deletion and benchmark re-runs remove the matching artifacts directory.
- Row sampling controls add `sample_cap` (100–250,000) to the create request and run
  document; the UI offers All / 10k / 50k / 100k. The run stores both the requested cap and
  the rows actually used.
- The benchmark comparison view (P1-5) is frontend-only: `/datasets/{id}/compare?left=&right=`
  fetches two persisted runs of the dataset, matches models by family, and shows best-model
  and per-family primary-metric deltas plus configuration caveats (target, task, folds,
  sampled rows, exclusions). Incompatible task types suppress deltas. It is descriptive, not
  a significance test. A picker on the dataset page appears once two runs exist.
- The bundled `model.joblib` is the project's fitted pipeline and needs the backend package to
  unpickle; the generated script rebuilds an equivalent standalone pipeline. This is stated
  in the bundle README, ARCHITECTURE §5.5, and the manifest note.

**Verification**

```bash
cd backend && pytest tests/test_export.py -q          # 9 passed
pytest -q                                              # 113 passed
cd ../frontend && npm test                             # 52 passed
```

Manual API walk (temporary storage root): uploaded a 300-row frame, ran a 3-fold benchmark
with `sample_cap: 120` (run recorded `sample_cap=120`, `sample_rows=120`), exported the best
model (LightGBM), and downloaded the ZIP. The manifest listed the four files, the download
responded with `application/zip` and `autoprofileml-city-lightgbm.zip`, and the archive
contained `train_model.py`, `train_model.ipynb`, `README.txt`, and `model.joblib`. The
generated script parsed with `ast.parse`; a separate standalone execution test runs it in a
subprocess and confirms it trains and writes a fresh `model.joblib`. The benchmark page
rendered the Export section with the Generate button.

Comparison walk: two runs of the same dataset (5 folds, full data vs 3 folds, 120 sampled
rows, `income_copy` excluded) rendered on `/datasets/{id}/compare?left=&right=` with the fold,
sample, and exclusion caveats, a best-model delta (+0.0516), per-family deltas for all four
models, and the dataset page showed the "Compare two runs" picker. A screenshot was inspected
for layout and clarity.

---

## Phase Dependency Map

```
Phase 0 (baseline)                    ✅ complete
   └── Phase 1 (tooling)              ✅ complete
         ├── Phase 2 (frontend scaffold)   ← next
         │     └── Phase 3 (API data layer)
         │           └── Phase 4 (dataset library)
         │                 └── Phase 5 (profile dashboard)
         └── Phase 6 (preprocessing)
               └── Phase 7 (benchmark arena)
                     └── Phase 8 (explainability)
                           └── Phase 9 (benchmark UI)  ← also needs Phase 5
                                 └── Phase 10 (hardening)
                                       └── Phase 11 (P1 export)
```

**Critical path to a demoable MVP:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.
Phases 6–8 can run in parallel with 4–5 if two developers are available, but Phase 9 requires
both branches complete.

---

## Estimated Effort

| Phase | Tasks | Estimate |
| --- | --- | --- |
| 1 — Tooling & baseline fixes | 17 | 3–4 h *(done)* |
| 2 — Frontend scaffold | 13 | 3–4 h |
| 3 — API data layer | 13 | 3 h |
| 4 — Dataset library | 16 | 4 h |
| 5 — Profile dashboard | 21 | 6–8 h |
| 6 — Preprocessing | 16 | 4–5 h |
| 7 — Benchmark arena | 24 | 7–9 h |
| 8 — Explainability | 14 | 4 h |
| 9 — Benchmark UI | 22 | 9–11 h |
| 10 — Hardening | 13 | 4–6 h |
| **MVP total** | **169** | **≈ 48–58 h** |
| 11 — P1 export | 12 | 6–10 h (optional) |

Estimates assume one developer familiar with the stack. Re-estimate after Phase 5 if
integration friction appears.
