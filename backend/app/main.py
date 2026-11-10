"""FastAPI application entrypoint for the AutoProfileML backend."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings

logger = logging.getLogger("autoprofileml")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app() -> FastAPI:
    """Build the FastAPI application."""

    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "AutoProfileML backend ready (env=%s, storage_root=%s)",
            settings.env,
            settings.storage_root.resolve(),
        )
        yield

    app = FastAPI(
        title="AutoProfileML API",
        description=("Transparent automated data profiling and machine learning benchmark engine."),
        version=__version__,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/health", tags=["meta"], summary="Health check")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__, "env": settings.env}

    return app


app = create_app()
