"""
Performance router - handles performance metrics and vLLM status endpoints.
"""

import logging
import numpy as np
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException

from ..models import PerformanceStatsRequest, PerformanceSummary
from ..vllm_metrics import get_vllm_metrics, check_vllm_health
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/performance", tags=["performance"])


def _convert_numpy_types(obj):
    """Recursively convert numpy types to Python types for JSON serialization."""
    if hasattr(obj, 'item'):
        return obj.item()
    elif isinstance(obj, dict):
        return {key: _convert_numpy_types(value) for key, value in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_convert_numpy_types(item) for item in obj]
    elif 'numpy' in str(type(obj)):
        return bool(obj) if isinstance(obj, (bool, np.bool_)) else str(obj)
    else:
        return obj


@router.get("/metrics")
def get_performance_metrics(
    limit: int = 100,
    query_type: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None
):
    """Get recent performance metrics."""
    try:
        metrics_list = deps.performance_metrics

        # Filter by query type
        if query_type:
            metrics_list = [m for m in metrics_list if m.query_type == query_type]

        # Filter by time range
        if start_time:
            try:
                start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                metrics_list = [m for m in metrics_list if m.timestamp >= start_dt]
            except Exception:
                pass

        if end_time:
            try:
                end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
                metrics_list = [m for m in metrics_list if m.timestamp <= end_dt]
            except Exception:
                pass

        # Return most recent
        recent = metrics_list[-limit:] if limit < len(metrics_list) else metrics_list

        # Convert to JSON-serializable format
        result = []
        for m in recent:
            m_dict = m.model_dump() if hasattr(m, 'model_dump') else m.__dict__
            result.append(_convert_numpy_types(m_dict))

        return {
            "metrics": result,
            "total": len(deps.performance_metrics),
            "filtered": len(metrics_list)
        }

    except Exception as e:
        logger.error("Error getting performance metrics: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get metrics: {e}")


@router.post("/stats")
def get_performance_stats(request: PerformanceStatsRequest):
    """Get aggregated performance statistics."""
    try:
        metrics_list = deps.performance_metrics

        # Filter by query type
        if request.query_type_filter:
            metrics_list = [m for m in metrics_list if m.query_type == request.query_type_filter]

        # Filter by time range
        if request.start_time:
            metrics_list = [m for m in metrics_list if m.timestamp >= request.start_time]

        if request.end_time:
            metrics_list = [m for m in metrics_list if m.timestamp <= request.end_time]

        # Apply limit
        if request.limit and len(metrics_list) > request.limit:
            metrics_list = metrics_list[-request.limit:]

        if not metrics_list:
            return {
                "total_requests": 0,
                "avg_total_duration_ms": 0,
                "avg_response_latency_ms": 0,
                "avg_component_durations": {},
                "rag_request_percentage": 0,
                "time_period_start": None,
                "time_period_end": None
            }

        # Calculate statistics
        total_durations = [m.total_duration_ms for m in metrics_list]
        avg_total = sum(total_durations) / len(total_durations) if total_durations else 0

        # Calculate average component durations
        component_totals = {}
        component_counts = {}
        for m in metrics_list:
            for timing in m.component_timings:
                component = timing.component
                if component not in component_totals:
                    component_totals[component] = 0
                    component_counts[component] = 0
                component_totals[component] += timing.duration_ms
                component_counts[component] += 1

        avg_component_durations = {
            component: component_totals[component] / component_counts[component]
            for component in component_totals
        }

        # Calculate response latency (first chunk latency for streaming)
        response_latencies = []
        for m in metrics_list:
            for timing in m.component_timings:
                if timing.component == "response_generation":
                    latency = timing.metadata.get("first_chunk_latency_ms", timing.duration_ms)
                    response_latencies.append(latency)
                    break

        avg_response_latency = sum(response_latencies) / len(response_latencies) if response_latencies else 0

        # RAG percentage
        rag_count = sum(1 for m in metrics_list if m.used_rag)
        rag_percentage = (rag_count / len(metrics_list)) * 100 if metrics_list else 0

        # Find bottleneck
        most_common_bottleneck = None
        if avg_component_durations:
            most_common_bottleneck = max(avg_component_durations, key=avg_component_durations.get)

        return _convert_numpy_types({
            "total_requests": len(metrics_list),
            "avg_total_duration_ms": avg_total,
            "avg_response_latency_ms": avg_response_latency,
            "avg_component_durations": avg_component_durations,
            "rag_request_percentage": rag_percentage,
            "most_common_bottleneck": most_common_bottleneck,
            "slowest_component_avg": most_common_bottleneck,
            "time_period_start": min(m.timestamp for m in metrics_list),
            "time_period_end": max(m.timestamp for m in metrics_list)
        })

    except Exception as e:
        logger.error("Error calculating performance stats: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to calculate stats: {e}")


@router.get("/vllm/metrics")
async def get_vllm_metrics_endpoint():
    """Get vLLM server metrics."""
    try:
        llm_url = deps.current_ui_settings.llm_base_url if deps.current_ui_settings else "http://localhost:8000/v1"
        metrics = await get_vllm_metrics(llm_url.replace("/v1", ""))
        return _convert_numpy_types(metrics)
    except Exception as e:
        logger.error("Error getting vLLM metrics: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get vLLM metrics: {e}")


@router.get("/vllm/health")
async def get_vllm_health():
    """Get vLLM server health status."""
    try:
        llm_url = deps.current_ui_settings.llm_base_url if deps.current_ui_settings else "http://localhost:8000/v1"
        health = await check_vllm_health(llm_url.replace("/v1", ""))
        return health
    except Exception as e:
        logger.error("Error checking vLLM health: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to check vLLM health: {e}")


@router.delete("/metrics")
def clear_performance_metrics():
    """Clear all stored performance metrics."""
    try:
        deps.performance_metrics.clear()
        return {"success": True, "message": "Performance metrics cleared"}
    except Exception as e:
        logger.error("Error clearing metrics: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to clear metrics: {e}")
