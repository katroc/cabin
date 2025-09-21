"""vLLM metrics integration for performance tracking."""

import re
import time
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime
import aiohttp
import asyncio

logger = logging.getLogger(__name__)


@dataclass
class VLLMMetrics:
    """Parsed vLLM prometheus metrics."""
    # Request metrics
    num_requests_running: int = 0
    num_requests_waiting: int = 0
    num_requests_swapped: int = 0

    # Performance metrics
    time_to_first_token_seconds: float = 0.0
    time_per_output_token_seconds: float = 0.0
    e2e_request_latency_seconds: float = 0.0

    # Throughput metrics
    prompt_tokens_total: int = 0
    generation_tokens_total: int = 0
    tokens_per_second: float = 0.0

    # GPU metrics
    gpu_cache_usage_perc: float = 0.0
    gpu_memory_usage: float = 0.0

    # Model info
    model_name: str = ""
    timestamp: datetime = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


class VLLMMetricsCollector:
    """Collects and parses vLLM prometheus metrics."""

    def __init__(self, services: Optional[Dict[str, str]] = None):
        """
        Initialize with vLLM service endpoints.

        Args:
            services: Dict mapping service names to base URLs
                     e.g. {"llm": "http://localhost:8000", "embeddings": "http://localhost:8001"}
        """
        self.services = services or {
            "llm": "http://localhost:8000",
            "embeddings": "http://localhost:8001",
            "reranker": "http://localhost:8002"
        }
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5))
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def fetch_metrics(self, service_name: str) -> Optional[VLLMMetrics]:
        """Fetch and parse metrics for a specific vLLM service."""
        if not self.session:
            raise RuntimeError("VLLMMetricsCollector must be used as async context manager")

        base_url = self.services.get(service_name)
        if not base_url:
            logger.warning(f"No URL configured for service: {service_name}")
            return None

        metrics_url = f"{base_url}/metrics"

        try:
            async with self.session.get(metrics_url) as response:
                if response.status != 200:
                    logger.warning(f"Failed to fetch metrics from {metrics_url}: {response.status}")
                    return None

                text = await response.text()
                return self._parse_prometheus_metrics(text, service_name)

        except asyncio.TimeoutError:
            logger.warning(f"Timeout fetching metrics from {metrics_url}")
            return None
        except Exception as e:
            logger.warning(f"Error fetching metrics from {metrics_url}: {e}")
            return None

    async def fetch_all_metrics(self) -> Dict[str, VLLMMetrics]:
        """Fetch metrics from all configured vLLM services."""
        results = {}

        for service_name in self.services:
            metrics = await self.fetch_metrics(service_name)
            if metrics:
                results[service_name] = metrics

        return results

    def _parse_prometheus_metrics(self, metrics_text: str, service_name: str) -> VLLMMetrics:
        """Parse prometheus metrics text into VLLMMetrics object."""
        metrics = VLLMMetrics(model_name=service_name)

        # Define metric patterns - use gauge patterns for current values and histogram _sum/_count for averages
        gauge_patterns = {
            'num_requests_running': r'vllm:num_requests_running{[^}]*}\s+([\d.e+-]+)',
            'num_requests_waiting': r'vllm:num_requests_waiting{[^}]*}\s+([\d.e+-]+)',
            'num_requests_swapped': r'vllm:num_requests_swapped{[^}]*}\s+([\d.e+-]+)',
            'prompt_tokens_total': r'vllm:prompt_tokens_total{[^}]*}\s+([\d.e+-]+)',
            'generation_tokens_total': r'vllm:generation_tokens_total{[^}]*}\s+([\d.e+-]+)',
            'gpu_cache_usage_perc': r'vllm:(?:gpu_cache_usage_perc|kv_cache_usage_perc){[^}]*}\s+([\d.e+-]+)',
        }

        # Histogram patterns for calculating averages from _sum and _count
        histogram_patterns = {
            'time_to_first_token_seconds': 'vllm:time_to_first_token_seconds',
            'time_per_output_token_seconds': 'vllm:time_per_output_token_seconds',
            'e2e_request_latency_seconds': 'vllm:e2e_request_latency_seconds',
        }

        # Parse gauge metrics
        for metric_name, pattern in gauge_patterns.items():
            match = re.search(pattern, metrics_text, re.MULTILINE)
            if match:
                try:
                    value = float(match.group(1))
                    # GPU cache usage is already a percentage (1.0 = 100%), but might be very small
                    if metric_name == 'gpu_cache_usage_perc':
                        value = value * 100  # Convert to 0-100 scale
                    setattr(metrics, metric_name, value)
                except (ValueError, AttributeError):
                    logger.debug(f"Failed to parse gauge {metric_name}: {match.group(1)}")

        # Parse histogram metrics (calculate averages from _sum and _count)
        for metric_name, metric_prefix in histogram_patterns.items():
            sum_pattern = rf'{metric_prefix}_sum{{[^}}]*}}\s+([\d.e+-]+)'
            count_pattern = rf'{metric_prefix}_count{{[^}}]*}}\s+([\d.e+-]+)'

            sum_match = re.search(sum_pattern, metrics_text, re.MULTILINE)
            count_match = re.search(count_pattern, metrics_text, re.MULTILINE)

            if sum_match and count_match:
                try:
                    sum_value = float(sum_match.group(1))
                    count_value = float(count_match.group(1))

                    if count_value > 0:
                        avg_value = sum_value / count_value
                        setattr(metrics, metric_name, avg_value)
                except (ValueError, AttributeError, ZeroDivisionError):
                    logger.debug(f"Failed to parse histogram {metric_name}")

        # Calculate tokens per second from totals and average latency
        if metrics.prompt_tokens_total > 0 or metrics.generation_tokens_total > 0:
            total_tokens = metrics.prompt_tokens_total + metrics.generation_tokens_total

            # Use average e2e latency if available, otherwise use time per output token
            if metrics.e2e_request_latency_seconds > 0:
                metrics.tokens_per_second = total_tokens / metrics.e2e_request_latency_seconds
            elif metrics.time_per_output_token_seconds > 0:
                # Rough estimate: total generation tokens / average time per token
                if metrics.generation_tokens_total > 0:
                    metrics.tokens_per_second = 1.0 / metrics.time_per_output_token_seconds

        return metrics

    async def health_check(self, service_name: str) -> bool:
        """Check if a vLLM service is healthy and responding."""
        if not self.session:
            raise RuntimeError("VLLMMetricsCollector must be used as async context manager")

        base_url = self.services.get(service_name)
        if not base_url:
            return False

        try:
            # Try the health endpoint first, fallback to metrics
            for endpoint in ["/health", "/metrics"]:
                try:
                    async with self.session.get(f"{base_url}{endpoint}") as response:
                        return response.status == 200
                except:
                    continue
            return False
        except Exception as e:
            logger.debug(f"Health check failed for {service_name}: {e}")
            return False


# Global metrics collector instance
metrics_collector = VLLMMetricsCollector()


async def get_vllm_metrics() -> Dict[str, Any]:
    """Get current vLLM metrics for all services."""
    async with VLLMMetricsCollector() as collector:
        metrics = await collector.fetch_all_metrics()

        # Convert to serializable format
        result = {}
        for service_name, service_metrics in metrics.items():
            result[service_name] = {
                "num_requests_running": service_metrics.num_requests_running,
                "num_requests_waiting": service_metrics.num_requests_waiting,
                "num_requests_swapped": service_metrics.num_requests_swapped,
                "time_to_first_token_seconds": service_metrics.time_to_first_token_seconds,
                "time_per_output_token_seconds": service_metrics.time_per_output_token_seconds,
                "e2e_request_latency_seconds": service_metrics.e2e_request_latency_seconds,
                "prompt_tokens_total": service_metrics.prompt_tokens_total,
                "generation_tokens_total": service_metrics.generation_tokens_total,
                "tokens_per_second": service_metrics.tokens_per_second,
                "gpu_cache_usage_perc": service_metrics.gpu_cache_usage_perc,
                "gpu_memory_usage": service_metrics.gpu_memory_usage,
                "model_name": service_metrics.model_name,
                "timestamp": service_metrics.timestamp.isoformat()
            }

        return result


async def check_vllm_health() -> Dict[str, bool]:
    """Check health status of all vLLM services."""
    async with VLLMMetricsCollector() as collector:
        health_status = {}
        for service_name in collector.services:
            health_status[service_name] = await collector.health_check(service_name)
        return health_status