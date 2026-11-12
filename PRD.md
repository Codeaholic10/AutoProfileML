# PRD.md — Product Requirements Document

**Product:** AutoProfileML — Transparent Automated Data Profiling & ML Benchmark Engine
**Status:** MVP definition · v1.0 · 2026-10-18
**Source of truth for technical decisions:** [ARCHITECTURE.md](ARCHITECTURE.md)
**Execution order:** [PLAN.md](PLAN.md)

---

## 1. Core Problem & Value Proposition

Machine-learning engineers spend most of their time on repetitive exploratory data analysis
and boilerplate preprocessing, while existing AutoML tools hide their decisions behind opaque
pipelines and binary artifacts. AutoProfileML turns a raw tabular dataset into an inspectable
profile, a leakage-free preprocessing pipeline, and a ranked benchmark of interpretable
models — with every transformation and result visible to the user. The value is speed without
lost trust: minutes from upload to a defended model choice, not a black box.

---

## 2. Target Audience

| Persona | Context | Primary need |
| --- | --- | --- |
| **ML engineer / data scientist** (primary) | Starting a new tabular ML task; needs baseline numbers and data-quality risks fast. | Profile a dataset, understand defects, get trustworthy baseline models. |
| **Analytics engineer** | Owns data quality but not necessarily modeling. | Spot missingness, constants, high cardinality, duplicates, and collinearity. |
| **Student / researcher** | Learning applied ML; needs visible, explainable steps. | See why a model was chosen and how features affect predictions. |
| **Reviewer / stakeholder** | Evaluates a model decision. | Inspect metrics, preprocessing choices, and SHAP-based explanations. |

**Assumed environment:** desktop browser, local or single-team deployment, datasets up to
hundreds of megabytes, no login required in the MVP.

---

## 3. Primary User Flows

### Flow A — Profile a new dataset (P0)

1. User opens the dashboard and sees an empty dataset library with an upload call-to-action.
2. User drops or selects a `.csv` or `.parquet` file (≤ 200 MB).
3. The app uploads the file, creates a dataset, and immediately shows a dataset page with a
   profiling job in `queued`/`running` state and stage-level progress.
4. When the job succeeds, the page reveals the profile overview: shape, memory, duplicates,
   column-type breakdown, and data-quality warnings.
5. User searches/sorts the column table, opens a column, and inspects dtype, missingness,
   unique count, distribution statistics, top values, and VIF/correlation findings.
6. If the file is invalid (wrong type, empty, oversized, unparsable), the app shows the
   specific reason and keeps the previous state intact.

### Flow B — Benchmark models for a target (P0)

1. From a profiled dataset, user opens **Benchmark**.
2. User selects a target column; the app proposes the task type (classification vs.
   regression) from the target's dtype/cardinality, and the user can override it.
3. User optionally excludes leakage-prone columns and sets the number of CV folds (default 5).
4. User starts the benchmark; a job shows training progress across models and folds.
5. On completion, the leaderboard ranks models by the task's primary metric and exposes
   secondary metrics, training time, and the preprocessing plan used.
6. User clicks **Explain best model**; a follow-up job produces global feature importance and
   per-row SHAP contributions.
7. If a model fails, the leaderboard shows that model as failed with an error while
   preserving the results of the others.

### Flow C — Revisit and re-run (P0)

1. User returns to the dataset library, which lists every dataset with profile availability
   and the latest job state.
2. User reopens a dataset and sees the stored profile and benchmark history without
   recomputation.
3. User re-runs profiling after replacing the underlying file (or deletes the dataset).

### Flow D — Export a deployable pipeline (P1)

1. From a completed benchmark, user requests an export.
2. The app produces a commented standalone Python script, a reproducible notebook, and the
   serialized pipeline, packaged as a ZIP.
3. User downloads the bundle and can reproduce training behavior outside the platform.

### Flow E — Failure recovery (P0)

- Upload rejected → inline reason (`415` unsupported type, `413` too large, empty file).
- Profile still computing → dataset page shows progress, not an error.
- Job failed → the dataset page shows the recorded error and a retry action.
- Profile request before completion → the UI never calls it until the job is terminal.

---

## 4. MVP Feature Scope

Priorities: **P0 = required for MVP**, **P1 = valuable, explicitly deferred past MVP**.
Every P0 item is independently demoable.

### 4.1 P0 — Must Have

| # | Feature | Acceptance criteria |
| --- | --- | --- |
| P0-1 | **Dataset upload** | Accepts CSV and Parquet (`.csv`, `.parquet`, `.pq`) up to 200 MB; rejects empty, unsupported, and oversized files with a specific message; upload returns immediately with a dataset ID and a queued job. |
| P0-2 | **Async profiling job** | Job states `queued → running → succeeded/failed`; monotonic progress and named stages; pollable by ID; failures persist an error message and never crash the server. |
| P0-3 | **Statistical profile** | Row/column count, memory size, duplicate rows/percentage, numeric/categorical counts; per-column dtype, semantic type, null count/percentage, unique count, constant flag; numeric mean, std, min, max, Q1, median, Q3, skewness, kurtosis; top 5 values with counts/percentages for categorical/boolean columns. |
| P0-4 | **Data-quality warnings** | Severity-tagged (`info`/`warning`/`critical`) warnings for constant columns, missing values, severe missingness (≥50%), high cardinality (≥50% unique), skewness (|skew| ≥ 1), multicollinearity (VIF ≥ 10), and duplicate rows; each warning names the column and explains the recommended action. |
| P0-5 | **Collinearity analysis** | VIF per numeric feature (moderate ≥ 5, severe ≥ 10) with the most-correlated peer; caps at 40 numeric features; degrades gracefully (never errors) on all-null/constant/disjoint-missing columns. |
| P0-6 | **Dataset library** | Lists datasets with filename, format, size, upload time, shape, profile availability, and latest job state; supports opening and deleting a dataset. |
| P0-7 | **Profile dashboard** | Overview KPIs; warnings grouped by severity; sortable/searchable column table; per-column detail with distribution/quartile visualization, missingness bar, top-values chart, and VIF findings; correlation heatmap for numeric features. |
| P0-8 | **Re-profile** | Re-runs profiling for an existing dataset and updates the stored report and shape metadata. |
| P0-9 | **Target selection & task detection** | User selects a target; app infers classification vs. regression from dtype/cardinality and allows an override; user can exclude features and choose 3–10 CV folds (default 5). |
| P0-10 | **Leakage-free preprocessing** | Imputation (adaptive: median, or KNN for small folds with complex missingness), IQR clipping, one-hot encoding for low-cardinality categoricals, target encoding for high-cardinality categoricals, and scaling for linear models are assembled into an sklearn `Pipeline`/`ColumnTransformer` fitted inside each CV fold only. The plan is displayed to the user in readable form (including which imputation ran). |
| P0-11 | **Benchmark arena** | Trains a linear baseline, Random Forest, LightGBM, and XGBoost with 5-fold CV; reports per-model status, fold-mean metrics, std, training time, and rank; one model failing does not abort the run. |
| P0-12 | **Task-aware metrics** | Classification: accuracy, macro F1, ROC-AUC (binary or OvR), log loss. Regression: RMSE, MAE, R². Primary ranking metric is macro F1 for classification and RMSE for regression. |
| P0-13 | **Benchmark history** | Completed runs are persisted and listed per dataset with target, task type, timestamp, best model, and headline metric; runs survive a backend restart (training results do, job progress does not). |
| P0-14 | **SHAP explainability** | For the selected/best tree or linear model, produce global mean-absolute SHAP importance and per-row contributions (base value + feature contributions) on a fixed-seed sample; explanations run from the persisted full-data refit pipeline and the UI labels CV metrics vs. refit explanations. |
| P0-15 | **Explainability UI** | Global importance bar chart, SHAP summary/beeswarm view, and a row-level explanation inspector that shows how each feature pushed the prediction up or down. |
| P0-15a | **Evaluation visuals** | Confusion matrix and per-class ROC curves from out-of-fold predictions for each succeeded classification model, plus a highest-confidence-mistakes table. |
| P0-16 | **Robust UX states** | Every async view has loading, empty, error, and success states; all errors are human-readable; charts have accessible text summaries; keyboard navigation and labels work. |
| P0-17 | **Configuration** | Upload limit, CORS origin, storage root, and API base URL are configurable via environment; no values are hardcoded in UI or routes. |

### 4.2 P1 — Nice to Have (post-MVP)

| # | Feature | Notes | Status |
| --- | --- | --- | --- |
| P1-1 | **Standalone code export** | Commented script generated from the fitted pipeline, matching preprocessing + hyperparameters. | ✅ |
| P1-2 | **Reproducible notebook export** | `.ipynb` mirroring the script with markdown explanations. | ✅ |
| P1-3 | **Artifact bundle** | ZIP containing script, notebook, `pipeline.pkl`, and (feasibility-gated) ONNX model. | ✅ (no ONNX — converters unavailable) |
| P1-4 | **Row sampling controls** | User-selectable sample size/seed for datasets above a benchmark threshold. | ✅ (sample size; seed stays fixed at 42) |
| P1-5 | **Benchmark comparison** | Side-by-side comparison of two runs for the same dataset. | ✅ |
| P1-6 | **Limited hyperparameter tuning** | Small randomized search for tree models, bounded by time. | ⏸ |
| P1-7 | **Additional models** | Extra learners (e.g., HistGradientBoosting, ElasticNet, SVM) behind the same registry. | ⏸ |
| P1-8 | **Authentication & multi-user workspaces** | Session-based login and per-user dataset ownership. | ⏸ |
| P1-9 | **Alternative storage backend** | S3/MinIO implementation of the existing `Storage` contract. | ⏸ |
| P1-10 | **Dark mode / theme toggle** | UI-only. | ⏸ (system theme already follows the OS) |
| P1-11 | **CI pipeline** | Lint, type-check, and tests on push. | ⏸ |

### 4.3 Release definition

The MVP is shippable when a reviewer can, without touching a terminal:

1. Upload a CSV or Parquet dataset.
2. Watch profiling complete and inspect every profile section and warning.
3. Select a target, run a benchmark, and read a ranked leaderboard with metrics.
4. Open SHAP explanations for the best model.
5. Revisit the dataset and its benchmark history after a page reload.
6. Recover from invalid uploads and failed jobs without losing prior data.

---

## 5. Explicit Non-Goals

These are **strictly out of scope** for the MVP. Do not build them, scaffold them, or add
dependencies for them without an explicit product decision.

1. **No unstructured data** — text, images, audio, video, or document datasets.
2. **No deep learning** — neural networks, embeddings, transformers, GPU training.
3. **No time-series forecasting**, survival analysis, or recommendation tasks.
4. **No AutoML search** — no neural architecture search, no exhaustive grid search, no
   Bayesian optimization in the MVP.
5. **No model serving** — no prediction API for end users, no deployment targets, no
   monitoring, drift detection, or retraining schedules.
6. **No authentication, accounts, roles, sharing, or multi-tenancy** in the MVP. The product
   is a single-tenant local tool.
7. **No external data connectors** — no database, warehouse, S3, Google Sheets, or URL
   ingestion; users upload files.
8. **No data editing** — users cannot modify cell values, rename columns, or fix dtypes in
   the UI; they re-upload a cleaned file.
9. **No custom user code execution** in the backend (no arbitrary Python/JS sandbox).
10. **No collaboration features** — comments, annotations, shared links, or activity feeds.
11. **No Excel, JSON, TSV, Avro, or compressed archive ingestion** beyond what Polars
    supports through CSV/Parquet.
12. **No ONNX export commitment** — evaluate feasibility in P1 before promising it.
13. **No cloud deployment or infrastructure automation** as part of the MVP deliverable.
14. **No mobile-native experience**; the dashboard targets desktop widths first with
    responsive degradation.

---

## 6. Success Metrics

| Area | Metric | Target |
| --- | --- | --- |
| Profiling speed | Upload → profile visible, 100k rows × 50 columns | ≤ 10 s on a development laptop |
| Profiling capacity | Profile job, 1M rows × 100 columns | Completes without OOM within 60 s |
| Benchmark speed | 4 models × 5 folds, 100k × 50 | ≤ 10 min |
| Correctness | Preprocessing leakage defects found in review | 0 |
| Transparency | Profile warnings with column + recommended action | 100% |
| Transparency | Benchmark runs exposing model config + preprocessing plan | 100% |
| Explainability | Benchmarks with SHAP output for the selected model | 100% of completed explanations |
| Reliability | Job failures recoverable via retry without restarting the app | 100% |
| Usability | Clicks from dataset page to leaderboard | ≤ 5 |
| Accessibility | Keyboard-operable primary flows; labeled controls | 100% |

---

## 7. Constraints & Assumptions

- **Single user, single backend process.** In-memory job state is lost on restart; persisted
  profiles and benchmark results are not.
- **Local disk storage** under `AUTOPROFILEML_STORAGE_ROOT` (default `./data`).
- **Tabular datasets only**, with a header row and standard delimiters for CSV. Schema
  inference samples up to 10,000 rows.
- **Reference environment:** Node 22, Python 3.11+, modern Chromium/Firefox/Safari.
- **Academic scope:** the product must stay demoable and defensible for a B.Tech minor
  project; every feature must be explainable to a reviewer.
- **P1 is not a promise.** Code export, ONNX, auth, and cloud storage are evaluated only
  after the MVP is complete and stable.

## 8. Open Questions (non-blocking; defaults chosen)

| Question | Default for MVP | Revisit |
| --- | --- | --- |
| Which target-encoding implementation? | `sklearn.preprocessing.TargetEncoder` inside CV. | If behavior proves insufficient, evaluate category_encoders. |
| How to cap benchmark size? | Train on full data up to 250k rows; sample above that with a fixed seed and a visible warning. | P1 adds manual controls. |
| Separate explanation job or part of benchmark? | Separate job, so training stays fast and explanations are optional. | Combine if UX proves simpler. |
| ONNX export? | Feasibility check before implementation. | P1. |
| Benchmark result storage? | JSON documents on disk, same as profiles. | Revisit only if multi-user is approved. |
