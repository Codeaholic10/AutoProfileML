"""P1 export: standalone training script, notebook, and model bundle.

Generated code is built from the run's fitted preprocessing plan and stored
hyperparameters, never from user-supplied source. Python is validated with
``ast.parse`` and the notebook JSON is reparsed before anything is packaged.
The backend never executes generated code.
"""

from __future__ import annotations

import ast
import io
import json
import re
import time
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import joblib

from app.core.config import Settings, get_settings
from app.core.jobs import JobStore, get_job_store
from app.models.benchmark import (
    BenchmarkRun,
    ModelResult,
    PreprocessingPlan,
    PreprocessingStep,
    TaskType,
)
from app.models.export import ExportCreateRequest, ExportFile, ExportManifest
from app.models.schemas import JobRecord, JobStatus
from app.services import ingestion
from app.services.benchmarking import (
    BenchmarkNotFoundError,
    BenchmarkNotReadyError,
    BenchmarkService,
    ModelNotFoundError,
    _safe_error,
)
from app.services.datasets import DatasetService
from app.services.preprocessing import describe_preprocessor, partition_features
from app.storage.base import Storage
from app.storage.factory import get_storage

EXPORT_SCRIPT_NAME = "train_model.py"
EXPORT_NOTEBOOK_NAME = "train_model.ipynb"
EXPORT_MODEL_NAME = "model.joblib"
EXPORT_README_NAME = "README.txt"
MAX_EXPORTED_HYPERPARAMETERS = 12
_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")

ONNX_NOTE = (
    "ONNX is not included: the project's pipelines use custom preprocessing classes "
    "(AdaptiveNumericImputer, IQRClipper, LabelEncodedClassifier) that skl2onnx has no "
    "converters for, so an ONNX file could not be derived faithfully."
)

# Fixed registry: generated source may only reference these classes.
_ESTIMATORS: dict[tuple[str, TaskType], tuple[str, str]] = {
    ("linear", TaskType.CLASSIFICATION): ("sklearn.linear_model", "LogisticRegression"),
    ("linear", TaskType.REGRESSION): ("sklearn.linear_model", "Ridge"),
    ("random_forest", TaskType.CLASSIFICATION): (
        "sklearn.ensemble",
        "RandomForestClassifier",
    ),
    ("random_forest", TaskType.REGRESSION): ("sklearn.ensemble", "RandomForestRegressor"),
    ("lightgbm", TaskType.CLASSIFICATION): ("lightgbm", "LGBMClassifier"),
    ("lightgbm", TaskType.REGRESSION): ("lightgbm", "LGBMRegressor"),
    ("xgboost", TaskType.CLASSIFICATION): ("xgboost", "XGBClassifier"),
    ("xgboost", TaskType.REGRESSION): ("xgboost", "XGBRegressor"),
}


class ExportNotFoundError(KeyError):
    """Raised when no export bundle has been generated for a model."""


class ExportUnsupportedError(ValueError):
    """Raised when a model cannot be rendered into standalone code."""


class ExportGenerationError(RuntimeError):
    """Raised when generated code fails its syntax or JSON validation."""


@dataclass(frozen=True)
class ExportDownload:
    """A resolved archive path plus the filename the client should see."""

    path: Path
    filename: str


def estimator_reference(family: str, task: TaskType) -> tuple[str, str]:
    """Return the (module, class) pair for a registry family."""

    try:
        return _ESTIMATORS[(family, task)]
    except KeyError as exc:
        raise ExportUnsupportedError(
            f"Model family '{family}' cannot be exported as standalone code."
        ) from exc


# --------------------------------------------------------------------------- #
# Rendering helpers
# --------------------------------------------------------------------------- #


def _comment(value: object) -> str:
    """Make a value safe for a single-line comment or plain-text line."""

    return str(value).replace("\r", " ").replace("\n", " ").strip()


def _literal(value: object) -> str:
    """Render a primitive (or a list of primitives) as a Python literal."""

    if value is None:
        return "None"
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return repr(value)
    if isinstance(value, list):
        return "[" + ", ".join(_literal(item) for item in value) + "]"
    raise ExportUnsupportedError(
        f"Unsupported value type in generated code: {type(value).__name__}."
    )


def _indent(text: str, spaces: int) -> str:
    prefix = " " * spaces
    return "\n".join(prefix + line if line else line for line in text.splitlines())


def _step(plan: PreprocessingPlan, kind: str) -> PreprocessingStep | None:
    return next((step for step in plan.steps if step.kind == kind), None)


def _int_param(step: PreprocessingStep | None, key: str, default: int) -> int:
    if step is None:
        return default
    value = step.parameters.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return int(value)


def _float_param(step: PreprocessingStep | None, key: str, default: float) -> float:
    if step is None:
        return default
    value = step.parameters.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


def _str_param(step: PreprocessingStep | None, key: str, default: str) -> str:
    if step is None:
        return default
    value = step.parameters.get(key)
    return value if isinstance(value, str) else default


def exported_hyperparameters(model: ModelResult) -> dict[str, float | int | str | bool]:
    """Primitive hyperparameters to embed, deterministic and bounded."""

    primitive = {
        key: value
        for key, value in model.hyperparameters.items()
        if value is not None and isinstance(value, (bool, int, float, str))
    }
    return dict(sorted(primitive.items())[:MAX_EXPORTED_HYPERPARAMETERS])


@dataclass(frozen=True)
class _Section:
    title: str
    markdown: str
    code: str


def _data_section(source_filename: str, target: str, model_name: str) -> _Section:
    code = "\n".join(
        [
            f"DATA_PATH = {_literal(source_filename)}  # replace with your data file",
            f"TARGET = {_literal(target)}",
            f"MODEL_NAME = {_literal(model_name)}",
            "MODEL_PATH = " + _literal(EXPORT_MODEL_NAME),
            "",
            "",
            "def load_frame(path: str) -> pl.DataFrame:",
            '    """Read a CSV or Parquet dataset."""',
            "",
            '    if path.lower().endswith((".parquet", ".pq")):',
            "        return pl.read_parquet(path)",
            "    return pl.read_csv(path)",
            "",
            "",
            "def load_training_data(path: str) -> tuple[pl.DataFrame, pl.Series]:",
            '    """Load features and target, refusing rows with a missing target."""',
            "",
            "    frame = load_frame(path)",
            "    target = frame[TARGET]",
            "    missing = target.null_count()",
            "    if missing:",
            "        raise ValueError(",
            '            f"{missing} row(s) have a missing target; clean the data first "',
            '            f"(for example frame.filter(pl.col(TARGET).is_not_null()))."',
            "        )",
            "    return frame.select(FEATURES), target",
        ]
    )
    markdown = (
        "## Load the data\n\n"
        f"Point `DATA_PATH` at the dataset (`{source_filename}`) and keep the same "
        "target and feature columns. Rows with a missing target are rejected rather "
        "than silently dropped."
    )
    return _Section("Load the data", markdown, code)


_IQR_CLIPPER_SOURCE = '''def _to_numpy(values: object) -> np.ndarray:
    """Convert a numpy array or Polars frame/series to a numpy array."""

    if isinstance(values, (pl.DataFrame, pl.Series)):
        return values.to_numpy()
    return np.asarray(values)


class IQRClipper(TransformerMixin, BaseEstimator):
    """Clip numeric columns to bounds learned from the training data."""

    def __init__(self, k: float = 1.5) -> None:
        self.k = k

    def fit(self, X: object, y: object = None) -> "IQRClipper":
        values = _to_numpy(X).astype(float, copy=False)
        q1 = np.nanquantile(values, 0.25, axis=0)
        q3 = np.nanquantile(values, 0.75, axis=0)
        iqr = q3 - q1
        self.lower_ = q1 - self.k * iqr
        self.upper_ = q3 + self.k * iqr
        return self

    def transform(self, X: object) -> np.ndarray:
        values = _to_numpy(X).astype(float, copy=True)
        for index in range(values.shape[1]):
            lower = float(self.lower_[index])
            upper = float(self.upper_[index])
            if np.isfinite(lower) and np.isfinite(upper):
                values[:, index] = np.clip(values[:, index], lower, upper)
        return values
'''

_LABEL_WRAPPER_SOURCE = '''class LabelEncodedClassifier(BaseEstimator, ClassifierMixin):
    """Train on integer class codes and predict the original labels."""

    def __init__(self, estimator: BaseEstimator) -> None:
        self.estimator = estimator

    def fit(self, X: object, y: object) -> "LabelEncodedClassifier":
        labels = np.asarray(y)
        self.encoder_ = LabelEncoder().fit(labels)
        self.classes_ = self.encoder_.classes_
        self.estimator_ = clone(self.estimator)
        self.estimator_.fit(X, self.encoder_.transform(labels))
        return self

    def predict(self, X: object) -> np.ndarray:
        encoded = np.asarray(self.estimator_.predict(X)).astype(int)
        return np.asarray(self.encoder_.inverse_transform(encoded))

    def predict_proba(self, X: object) -> np.ndarray:
        return np.asarray(self.estimator_.predict_proba(X))
'''


def _helpers_section(plan: PreprocessingPlan, task: TaskType) -> _Section | None:
    blocks: list[str] = []
    if plan.numeric_features:
        blocks.append(_IQR_CLIPPER_SOURCE)
    if task == TaskType.CLASSIFICATION:
        blocks.append(_LABEL_WRAPPER_SOURCE)
    if not blocks:
        return None
    lead = (
        "Two small helpers reproduce the project's custom preprocessing steps with "
        "plain scikit-learn classes: IQR clipping and string-label handling."
        if len(blocks) == 2
        else "A small helper reproduces the project's custom preprocessing step with "
        "plain scikit-learn classes."
    )
    return _Section(
        "Helpers",
        f"## Helper transformers\n\n{lead}",
        "\n\n".join(blocks).rstrip("\n"),
    )


def _preprocessing_section(plan: PreprocessingPlan, task: TaskType) -> _Section:
    numeric_step = _step(plan, "numeric_impute")
    clip_step = _step(plan, "iqr_clip")
    target_step = _step(plan, "target_encode")
    scaled = any(step.kind == "standard_scale" for step in plan.steps)

    strategy = (
        numeric_step.strategy
        if numeric_step is not None and numeric_step.strategy is not None
        else "median"
    )
    if strategy == "knn":
        neighbors = _int_param(numeric_step, "knn_neighbors", 5)
        imputer = f"KNNImputer(n_neighbors={neighbors})"
    else:
        imputer = 'SimpleImputer(strategy="median")'
    clip_k = _literal(_float_param(clip_step, "k", 1.5))

    lines = [
        f"NUMERIC_FEATURES = {_literal(plan.numeric_features)}",
        f"ONE_HOT_FEATURES = {_literal(plan.one_hot_encoding)}",
        f"TARGET_ENCODED_FEATURES = {_literal(plan.target_encoding)}",
        "FEATURES = NUMERIC_FEATURES + ONE_HOT_FEATURES + TARGET_ENCODED_FEATURES",
        "",
        "preprocessor = ColumnTransformer(",
        "    transformers=[",
    ]
    if plan.numeric_features:
        lines.extend(
            [
                "        (",
                '            "numeric",',
                "            Pipeline([",
                f'                ("imputer", {imputer}),',
                f'                ("clipper", IQRClipper(k={clip_k})),',
            ]
        )
        if scaled:
            lines.append('                ("scaler", StandardScaler()),')
        lines.extend(
            [
                "            ]),",
                "            NUMERIC_FEATURES,",
                "        ),",
            ]
        )
    if plan.one_hot_encoding:
        lines.extend(
            [
                "        (",
                '            "low_cardinality",',
                "            Pipeline([",
                '                ("imputer", SimpleImputer(strategy="most_frequent")),',
                "                (",
                '                    "encoder",',
                '                    OneHotEncoder(handle_unknown="ignore", sparse_output=False),',
                "                ),",
                "            ]),",
                "            ONE_HOT_FEATURES,",
                "        ),",
            ]
        )
    if plan.target_encoding:
        cv_folds = _int_param(target_step, "cv_folds", 5)
        random_state = _int_param(target_step, "random_state", 42)
        smooth = _str_param(target_step, "smooth", "auto")
        target_type = "continuous" if task == TaskType.REGRESSION else "auto"
        splitter = "StratifiedKFold" if task == TaskType.CLASSIFICATION else "KFold"
        lines.extend(
            [
                "        (",
                '            "high_cardinality",',
                "            Pipeline([",
                '                ("imputer", SimpleImputer(strategy="most_frequent")),',
                "                (",
                '                    "encoder",',
                "                    TargetEncoder(",
                f"                        target_type={_literal(target_type)},",
                f"                        smooth={_literal(smooth)},",
                "                        cv=" + splitter + "(",
                f"                            n_splits={cv_folds},",
                "                            shuffle=True,",
                f"                            random_state={random_state},",
                "                        ),",
                "                    ),",
                "                ),",
                "            ]),",
                "            TARGET_ENCODED_FEATURES,",
                "        ),",
            ]
        )
    lines.extend(
        [
            "    ],",
            '    remainder="drop",',
            "    verbose_feature_names_out=False,",
            ")",
        ]
    )
    markdown = (
        "## Preprocessing\n\n"
        "Every learned step lives inside the pipeline, exactly as it was fitted in "
        "cross-validation: numeric imputation, IQR clipping, categorical imputation, "
        "one-hot or target encoding, and scaling for linear models. Fitting this "
        "pipeline on your training data reproduces the project's behavior."
    )
    return _Section("Preprocessing", markdown, "\n".join(lines))


def _model_section(model: ModelResult, task: TaskType) -> _Section:
    _module, class_name = estimator_reference(model.family, task)
    params = exported_hyperparameters(model)
    param_lines = [f"    {key}={_literal(value)}," for key, value in params.items()]
    inner = "\n".join([f"{class_name}(", *param_lines, ")"])
    if task == TaskType.CLASSIFICATION:
        code = "\n".join(
            [
                "model = LabelEncodedClassifier(",
                _indent(inner, 4),
                ")",
            ]
        )
    else:
        code = f"model = {inner}"
    markdown = (
        f"## Model\n\n"
        f"`{model.name}` with the hyperparameters recorded by the benchmark. "
        "Classification targets are label-encoded and decoded back to the original "
        "labels so string targets work with every family."
    )
    return _Section("Model", markdown, code)


def _training_section() -> _Section:
    code = "\n".join(
        [
            "pipeline = Pipeline(",
            "    [",
            '        ("preprocessor", preprocessor),',
            '        ("model", model),',
            "    ]",
            ")",
            "",
            'if __name__ == "__main__":',
            "    X, y = load_training_data(DATA_PATH)",
            "    pipeline.fit(X, y)",
            "    joblib.dump(pipeline, MODEL_PATH)",
            '    print(f"Trained {MODEL_NAME} on {X.height} rows; saved to {MODEL_PATH}")',
            "",
            "    # Score new rows that have the same feature columns:",
            '    # new_rows = load_frame("new_rows.csv").select(FEATURES)',
            "    # predictions = pipeline.predict(new_rows)",
        ]
    )
    markdown = (
        "## Train and save\n\n"
        "Run `python train_model.py` after setting `DATA_PATH`. The fitted pipeline "
        "is written next to the script as `model.joblib`."
    )
    return _Section("Train and save", markdown, code)


def _sections(
    run: BenchmarkRun,
    model: ModelResult,
    plan: PreprocessingPlan,
    source_filename: str,
) -> list[_Section]:
    metrics = ", ".join(f"{name}={value:.4f}" for name, value in sorted(model.metrics.items()))
    header_code = "\n".join(
        [
            "# AutoProfileML standalone training script.",
            f"# Benchmark: {_comment(run.benchmark_id)}",
            f"# Model: {_comment(model.name)} ({_comment(model.family)})",
            f"# Target: {_comment(run.target)}",
            f"# Task: {_comment(run.task_type.value)}, {run.folds}-fold cross-validation",
            f"# CV metrics: {_comment(metrics or 'not recorded')}",
            f"# Generated: {_comment(datetime.now(UTC).isoformat(timespec='seconds'))}",
        ]
    )
    header = _Section(
        "Header",
        f"# {model.name} for `{run.target}`\n\n"
        f"Standalone training code generated by AutoProfileML from benchmark "
        f"`{run.benchmark_id}` ({run.task_type.value}, {run.folds}-fold CV).\n\n"
        f"Cross-validated metrics: {metrics or 'not recorded'}.",
        header_code,
    )

    module, class_name = estimator_reference(model.family, run.task_type)
    base_names = ["BaseEstimator"]
    if plan.numeric_features:
        base_names.append("TransformerMixin")
    if run.task_type == TaskType.CLASSIFICATION:
        base_names.extend(["ClassifierMixin", "clone"])
    import_lines = ["import joblib"]
    if plan.numeric_features or run.task_type == TaskType.CLASSIFICATION:
        import_lines.append("import numpy as np")
    import_lines.extend(
        [
            "import polars as pl",
            f"from sklearn.base import {', '.join(sorted(base_names))}",
            "from sklearn.compose import ColumnTransformer",
        ]
    )
    numeric_impute = _step(plan, "numeric_impute")
    impute_names = ["SimpleImputer"]
    if numeric_impute is not None and numeric_impute.strategy == "knn":
        impute_names.append("KNNImputer")
    import_lines.append(f"from sklearn.impute import {', '.join(sorted(impute_names))}")
    if plan.target_encoding:
        import_lines.append("from sklearn.model_selection import KFold, StratifiedKFold")
    import_lines.append("from sklearn.pipeline import Pipeline")
    preprocessing_names: list[str] = []
    if plan.one_hot_encoding:
        preprocessing_names.append("OneHotEncoder")
    if plan.numeric_features and any(step.kind == "standard_scale" for step in plan.steps):
        preprocessing_names.append("StandardScaler")
    if plan.target_encoding:
        preprocessing_names.append("TargetEncoder")
    if run.task_type == TaskType.CLASSIFICATION:
        preprocessing_names.append("LabelEncoder")
    if preprocessing_names:
        import_lines.append(
            f"from sklearn.preprocessing import {', '.join(sorted(preprocessing_names))}"
        )
    import_lines.append(f"from {module} import {class_name}")
    imports = _Section("Imports", "## Imports", "\n".join(import_lines))

    sections = [
        header,
        imports,
        _data_section(source_filename, run.target, model.name),
    ]
    helpers = _helpers_section(plan, run.task_type)
    if helpers is not None:
        sections.append(helpers)
    sections.extend(
        [
            _preprocessing_section(plan, run.task_type),
            _model_section(model, run.task_type),
            _training_section(),
        ]
    )
    return sections


def render_training_script(
    run: BenchmarkRun,
    model: ModelResult,
    plan: PreprocessingPlan,
    source_filename: str,
) -> str:
    """Render a standalone, syntax-checked Python training script."""

    sections = _sections(run, model, plan, source_filename)
    source = "\n\n\n".join(section.code.rstrip("\n") for section in sections) + "\n"
    try:
        ast.parse(source)
    except SyntaxError as exc:
        raise ExportGenerationError(
            f"Generated training script is not valid Python: {exc.msg}"
        ) from exc
    return source


def _cell_source(text: str) -> list[str]:
    lines = text.splitlines(keepends=True)
    return lines if lines else [""]


def render_notebook(
    run: BenchmarkRun,
    model: ModelResult,
    plan: PreprocessingPlan,
    source_filename: str,
) -> str:
    """Render a v4 notebook mirroring the script, validated as JSON."""

    cells: list[dict[str, object]] = []
    for section in _sections(run, model, plan, source_filename):
        cells.append(
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": _cell_source(section.markdown),
            }
        )
        cells.append(
            {
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": _cell_source(section.code),
            }
        )
    cells.append(
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": _cell_source(
                "## Notes\n\n"
                "- The metrics shown come from cross-validation on the sampled "
                "training data; the exported pipeline is refit on that data.\n"
                "- `model.joblib` in this bundle is the project's fitted pipeline. "
                "Unpickling it requires the AutoProfileML backend package because of "
                "its custom preprocessing classes. Running the notebook rebuilds an "
                "equivalent pipeline with plain scikit-learn.\n"
                f"- {ONNX_NOTE}"
            ),
        }
    )
    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    try:
        document = json.loads(json.dumps(notebook))
    except (TypeError, ValueError) as exc:
        raise ExportGenerationError("Generated notebook is not valid JSON.") from exc
    return json.dumps(document, indent=2)


def render_readme(
    run: BenchmarkRun,
    model: ModelResult,
    source_filename: str,
) -> str:
    """Render the plain-text guide that accompanies the bundle."""

    metrics = ", ".join(f"{name}={value:.4f}" for name, value in sorted(model.metrics.items()))
    sampled = (
        f"fixed-seed sample of {run.sample_rows} rows"
        if run.sample_rows is not None
        else "full dataset"
    )
    excluded = ", ".join(run.excluded_features) if run.excluded_features else "none"
    lines = [
        "AutoProfileML export bundle",
        "===========================",
        "",
        f"Benchmark : {_comment(run.benchmark_id)}",
        f"Target    : {_comment(run.target)}",
        f"Task      : {_comment(run.task_type.value)}",
        f"Model     : {_comment(model.name)} ({_comment(model.family)})",
        f"Model ID  : {_comment(model.model_id)}",
        f"Training  : {run.folds}-fold CV, {sampled}",
        f"Excluded  : {_comment(excluded)}",
        f"Metrics   : {_comment(metrics or 'not recorded')}",
        f"Created   : {_comment(datetime.now(UTC).isoformat(timespec='seconds'))}",
        "",
        f"Source file: {_comment(source_filename)}",
        "",
        "Files",
        "-----",
        f"{EXPORT_SCRIPT_NAME:<18} Standalone scikit-learn training script.",
        f"{EXPORT_NOTEBOOK_NAME:<18} The same workflow as a notebook with markdown notes.",
        f"{EXPORT_MODEL_NAME:<18} The fitted pipeline from the benchmark run.",
        "",
        "Running the script",
        "------------------",
        '1. pip install "polars>=1.44" "scikit-learn>=1.9" "joblib>=1.6"',
        "   (add lightgbm or xgboost if the exported model uses them).",
        "2. Put your data next to the script and set DATA_PATH.",
        "3. python train_model.py",
        "",
        "About model.joblib",
        "------------------",
        "The bundled model.joblib is the pipeline AutoProfileML fitted. Its",
        "preprocessing steps are project classes, so unpickling it requires the",
        "AutoProfileML backend package on the Python path. Running the script",
        "rebuilds an equivalent pipeline with plain scikit-learn and writes its own",
        "model.joblib in the working directory.",
        "",
        "ONNX",
        "----",
        ONNX_NOTE,
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ExportService:
    """Coordinates export jobs and their ZIP bundles."""

    def __init__(
        self,
        storage: Storage | None = None,
        job_store: JobStore | None = None,
        settings: Settings | None = None,
        dataset_service: DatasetService | None = None,
        benchmark_service: BenchmarkService | None = None,
    ) -> None:
        self._storage = storage or get_storage()
        self._jobs = job_store or get_job_store()
        self._settings = settings or get_settings()
        self._datasets = dataset_service or DatasetService(
            storage=self._storage,
            job_store=self._jobs,
            settings=self._settings,
        )
        self._benchmarks = benchmark_service or BenchmarkService(
            storage=self._storage,
            job_store=self._jobs,
            settings=self._settings,
            dataset_service=self._datasets,
        )

    # Paths -----------------------------------------------------------------

    def _artifact_dir(self, benchmark_id: str) -> Path:
        if _ID_PATTERN.fullmatch(benchmark_id) is None:
            raise BenchmarkNotFoundError(benchmark_id)
        return self._settings.artifacts_dir / benchmark_id

    def _archive_path(self, benchmark_id: str, model_id: str) -> Path:
        return self._artifact_dir(benchmark_id) / f"{model_id}.zip"

    def _manifest_path(self, benchmark_id: str, model_id: str) -> Path:
        return self._artifact_dir(benchmark_id) / f"{model_id}.json"

    # Validation ------------------------------------------------------------

    @staticmethod
    def _require_model(run: BenchmarkRun, model_id: str) -> ModelResult:
        if _ID_PATTERN.fullmatch(model_id) is None:
            raise ModelNotFoundError(model_id)
        model = next(
            (
                candidate
                for candidate in run.leaderboard
                if candidate.model_id == model_id and candidate.status == "succeeded"
            ),
            None,
        )
        if model is None:
            raise ModelNotFoundError(model_id)
        return model

    def _require_ready_run(self, benchmark_id: str) -> BenchmarkRun:
        run = self._benchmarks.get_benchmark(benchmark_id)
        if run.status != JobStatus.SUCCEEDED:
            raise BenchmarkNotReadyError("Exports are not available until the benchmark completes.")
        return run

    # Orchestration ---------------------------------------------------------

    def enqueue(
        self,
        benchmark_id: str,
        request: ExportCreateRequest,
    ) -> tuple[str, BenchmarkRun, ModelResult, JobRecord]:
        """Validate the request and create the export job."""

        run = self._require_ready_run(benchmark_id)
        model = self._require_model(run, request.model_id)
        estimator_reference(model.family, run.task_type)
        self._benchmarks.get_model_path(benchmark_id, request.model_id)

        export_id = uuid.uuid4().hex
        job = self._jobs.create(kind="export", dataset_id=run.dataset_id)
        return export_id, run, model, job

    def run_export(
        self,
        export_id: str,
        benchmark_id: str,
        model_id: str,
        job_id: str,
    ) -> None:
        """Background entrypoint: render the sources, package the ZIP, persist it."""

        started = time.perf_counter()
        try:
            self._jobs.update(job_id, status=JobStatus.RUNNING, stage="loading", progress=0.1)
            run = self._benchmarks.get_benchmark(benchmark_id)
            model = self._require_model(run, model_id)
            summary = self._datasets.get_dataset(run.dataset_id)
            frame = ingestion.load_dataset(
                self._datasets.dataset_file(run.dataset_id), summary.format
            )
            profile = self._datasets.get_profile(run.dataset_id)
            partition = partition_features(frame, run.target, run.excluded_features, profile)
            pipeline = joblib.load(self._benchmarks.get_model_path(benchmark_id, model_id))

            self._jobs.update(job_id, stage="generating", progress=0.4)
            plan = describe_preprocessor(
                pipeline.named_steps["preprocessor"],
                partition,
                random_state=run.random_state,
            )
            script = render_training_script(run, model, plan, summary.filename)
            notebook = render_notebook(run, model, plan, summary.filename)
            readme = render_readme(run, model, summary.filename)

            self._jobs.update(job_id, stage="packaging", progress=0.75)
            archive, sizes = self._build_archive(pipeline, script, notebook, readme)
            self._storage.write_bytes(self._archive_path(benchmark_id, model_id), archive)

            manifest = ExportManifest(
                export_id=export_id,
                benchmark_id=benchmark_id,
                model_id=model_id,
                target=run.target,
                task_type=run.task_type,
                model_name=model.name,
                files=[ExportFile(name=name, size_bytes=size) for name, size in sizes.items()],
                size_bytes=len(archive),
                includes_onnx=False,
                onnx_note=ONNX_NOTE,
                created_at=_utcnow(),
                duration_ms=round((time.perf_counter() - started) * 1000, 3),
            )
            self._storage.write_text(
                self._manifest_path(benchmark_id, model_id),
                manifest.model_dump_json(),
            )

            self._jobs.succeed(
                job_id,
                {
                    "export_id": export_id,
                    "benchmark_id": benchmark_id,
                    "model_id": model_id,
                    "size_bytes": len(archive),
                    "files": [file.name for file in manifest.files],
                    "duration_ms": manifest.duration_ms,
                },
            )
        except Exception as exc:  # noqa: BLE001 - surfaced through the job
            self._jobs.fail(job_id, _safe_error(exc, self._settings))

    @staticmethod
    def _build_archive(
        pipeline: object,
        script: str,
        notebook: str,
        readme: str,
    ) -> tuple[bytes, dict[str, int]]:
        model_buffer = io.BytesIO()
        joblib.dump(pipeline, model_buffer)
        payloads = {
            EXPORT_SCRIPT_NAME: script.encode("utf-8"),
            EXPORT_NOTEBOOK_NAME: notebook.encode("utf-8"),
            EXPORT_README_NAME: readme.encode("utf-8"),
            EXPORT_MODEL_NAME: model_buffer.getvalue(),
        }
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for name, payload in payloads.items():
                bundle.writestr(name, payload)
        sizes = {name: len(payload) for name, payload in payloads.items()}
        return archive.getvalue(), sizes

    # Reads -----------------------------------------------------------------

    def get_manifest(self, benchmark_id: str, model_id: str) -> ExportManifest:
        """Load a generated manifest, distinguishing missing from not-ready."""

        run = self._require_ready_run(benchmark_id)
        self._require_model(run, model_id)
        path = self._manifest_path(benchmark_id, model_id)
        if not self._storage.exists(path):
            raise ExportNotFoundError(model_id)
        try:
            return ExportManifest.model_validate_json(self._storage.read_text(path))
        except ValueError as exc:
            raise ExportNotFoundError(model_id) from exc

    def get_download(self, benchmark_id: str, model_id: str) -> ExportDownload:
        """Resolve the archive path and a safe download filename."""

        run = self._require_ready_run(benchmark_id)
        model = self._require_model(run, model_id)
        path = self._archive_path(benchmark_id, model_id)
        artifacts_root = self._settings.artifacts_dir.resolve()
        if not path.resolve().is_relative_to(artifacts_root):
            raise ExportNotFoundError(model_id)
        if not self._storage.exists(path):
            raise ExportNotFoundError(model_id)
        filename = f"autoprofileml-{_slug(run.target)}-{_slug(model.name)}.zip"
        return ExportDownload(path=path, filename=filename)


def _slug(value: str) -> str:
    """Build a safe download filename segment."""

    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned[:40] or "model"
