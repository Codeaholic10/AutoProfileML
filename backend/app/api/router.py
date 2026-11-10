"""Aggregate API router."""

from fastapi import APIRouter

from app.api.routes import benchmarks, datasets

api_router = APIRouter()
api_router.include_router(datasets.router)
api_router.include_router(benchmarks.router)
