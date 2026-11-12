# AutoProfileML

Transparent automated data profiling and machine-learning benchmarking for tabular datasets.

Upload a CSV or Parquet file, get a fast statistical profile with data-quality warnings, then
run a leakage-free benchmark of four models and inspect SHAP explanations. This repository is
the **v0.1.0 MVP** release.

## Roadmap & Synopsis

The product requirements derive from `AutoProfileML_Synopsis.pdf`. Its five methodology phases
map onto the roadmap phases in order — see "Synopsis Alignment" in [PLAN.md](PLAN.md) for the
full mapping and the three documented adaptations (adaptive/KNN imputation bounds, sequential
model training, and code-generation wording).

## Project Status

| Area | Status |
| --- | --- |
| Backend API (ingestion, profiling, jobs) | ✅ Implemented |
| Frontend (Next.js dashboard) | ✅ Dataset library, upload/delete, profile dashboard, benchmark leaderboard and SHAP views (Phases 2–5, 9) |
| Preprocessing engine (leakage-free) | ✅ Implemented (Phase 6) |
| Benchmark arena (models, CV, ranking, OOF) | ✅ Backend implemented (Phase 7) |
| SHAP explainability (global + per-row) | ✅ Backend implemented (Phase 8) |
| Benchmark & explanation UI | ✅ Implemented (Phase 9) |
| Code/artifact export (script, notebook, ZIP) | ✅ Implemented (P1, no ONNX) |

See [PRD.md](PRD.md) for scope, [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design,
[PLAN.md](PLAN.md) for the execution roadmap, and [CLAUDE.md](CLAUDE.md) for contributor and
agent rules.

## Prerequisites

- **Python 3.11+** (the local venv is 3.14.6)
- **pip** and **venv** (bundled with Python)
- **Node.js 22+** and **npm 10+** for the frontend
- **Git Bash** on Windows (all documented commands use POSIX shell syntax)

No database, Redis, Docker, or external services are required.

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate        # Git Bash on Windows
pip install -e ".[dev]"
cp .env.example .env                 # optional; defaults work as-is
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

- API: `http://localhost:8000`
- Health: `http://localhost:8000/health`
- OpenAPI docs: `http://localhost:8000/docs`

## Backend Checks

```bash
cd backend
bash scripts/check.sh        # lint + format + mypy + tests, in that order
```

Individually:

```bash
cd backend
source .venv/Scripts/activate

ruff check .                 # lint
ruff format --check .        # format check
mypy app                     # strict type-check
pytest -q                    # tests
```

Run a single test file or case:

```bash
pytest tests/test_profiling.py -q
pytest tests/test_api.py::test_upload_profiles_dataset_end_to_end -q
```

## Configuration

Backend settings use the `AUTOPROFILEML_` prefix and can be set in `backend/.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AUTOPROFILEML_ENV` | `development` | Environment label |
| `AUTOPROFILEML_STORAGE_ROOT` | `./data` | Dataset, profile, and artifact storage |
| `AUTOPROFILEML_MAX_UPLOAD_MB` | `200` | Maximum upload size |
| `AUTOPROFILEML_CORS_ORIGINS` | `http://localhost:3000` | Allowed frontend origins (comma-separated) |
| `AUTOPROFILEML_JOB_RETENTION_SECONDS` | `21600` | In-memory job retention (6 hours) |

Runtime data under `data/`, virtual environments, caches, and `.env` files are gitignored.

## Current API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health, version, environment |
| `POST` | `/api/datasets` | Upload CSV/Parquet and queue profiling |
| `GET` | `/api/datasets` | List datasets with profile/job state |
| `GET` | `/api/datasets/{id}` | Dataset metadata |
| `DELETE` | `/api/datasets/{id}` | Delete a dataset, its metadata, and its profile (`204`) |
| `GET` | `/api/datasets/{id}/profile` | Stored profile (`409` while pending) |
| `POST` | `/api/datasets/{id}/profile` | Re-run profiling |
| `GET` | `/api/datasets/{id}/jobs` | Job history for a dataset |
| `GET` | `/api/jobs/{id}` | Poll a job |
| `POST` | `/api/datasets/{id}/benchmarks` | Queue a benchmark run for a target (`202`) |
| `GET` | `/api/datasets/{id}/benchmarks` | Benchmark history for a dataset |
| `GET` | `/api/benchmarks/{id}` | Run plus ranked leaderboard |
| `GET` | `/api/benchmarks/{id}/models/{model_id}/predictions` | Out-of-fold predictions (`400` for regression) |
| `POST` | `/api/benchmarks/{id}/explanations` | Queue a SHAP explanation (`202`) |
| `GET` | `/api/benchmarks/{id}/explanations/{model_id}` | Stored explanation (`404` until generated, `409` while the run is pending) |
| `POST` | `/api/benchmarks/{id}/exports` | Queue a standalone export bundle for a model (`202`) |
| `GET` | `/api/benchmarks/{id}/exports/{model_id}` | Bundle manifest (`404` until generated, `409` while the run is pending) |
| `GET` | `/api/benchmarks/{id}/exports/{model_id}/download` | Download the script + notebook + model ZIP |

## Frontend

The dashboard in `frontend/` is built with Next.js 16 (App Router, Turbopack), Tailwind v4, and
shadcn/ui. It lists datasets, uploads CSV/Parquet files with client-side validation, deletes
datasets behind a confirmation dialog, and renders the full profile: KPI overview, warnings by
severity, a sortable/filterable column table with detail dialogs, top-value and quartile
charts, VIF findings, and a correlation heatmap. From the dataset page it runs benchmarks and
renders the ranked leaderboard, preprocessing plan, confusion matrix, ROC curves,
highest-confidence mistakes, and SHAP global/local explanations, and downloads a standalone
export bundle (training script, notebook, and fitted pipeline). See
[frontend/README.md](frontend/README.md) for toolchain notes.

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test
```

The frontend reads the API base URL from `NEXT_PUBLIC_API_BASE_URL`
(default `http://localhost:8000`).

## Troubleshooting

- **`ruff format` panics with a range error:** the files previously contained a UTF-8 BOM.
  They have been stripped; `.editorconfig` now enforces plain UTF-8. Re-clone or re-save the
  file without BOM if it reappears.
- **Port already in use:** run Uvicorn on another port (`--port 8001`) and set
  `NEXT_PUBLIC_API_BASE_URL` to match.
- **Browser requests blocked by CORS:** add the frontend origin to
  `AUTOPROFILEML_CORS_ORIGINS` (comma-separated) and restart the backend.
- **Uploads rejected:** the limit is `AUTOPROFILEML_MAX_UPLOAD_MB` (200 MB default); only
  `.csv`, `.parquet`, and `.pq` are accepted. Empty files return `400`, oversized files `413`,
  and unsupported types `415`.
- **Where did my data go?** Everything is under `AUTOPROFILEML_STORAGE_ROOT` (default
  `backend/data/` while running from `backend/`). The directory is gitignored.
- **Job disappeared after restart:** job progress is in memory by design; profiles and
  benchmark results persist on disk.
- **A re-profile failed:** the previous profile and dataset shape are preserved; fix the file
  and re-run profiling. The job error names the dataset and the parser problem.

## MVP Constraints

- Single-user, single-process backend; job progress is in memory and lost on restart.
- Profiles, benchmark runs, models, explanations, and export bundles persist on local disk.
- Benchmark, explanation, and export jobs cannot be cancelled and have no server-side
  timeout; they run to completion or failure.
- Exported `model.joblib` files require the backend package to unpickle; the generated
  training script rebuilds a standalone pipeline. ONNX is not supported, and the benchmark
  comparison view remains deferred.
- No authentication or multi-tenancy in the MVP.
- Tabular CSV/Parquet only; no deep learning, time-series, or unstructured data.
