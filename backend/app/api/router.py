"""Aggregate API router."""

from fastapi import APIRouter

from app.api.routes import benchmarks, datasets, explanations, exports

api_router = APIRouter()
api_router.include_router(datasets.router)
api_router.include_router(benchmarks.router)
api_router.include_router(explanations.router)
api_router.include_router(exports.router)
