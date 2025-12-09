"""
Chat router - handles all chat-related endpoints.
Extracted from main.py to improve code organization.
"""

import json
import logging
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse

from ..models import (
    ChatRequest, ChatResponse, RAGPerformanceMetrics,
    Citation, ComponentTiming
)
from ..citations import render_citation_payloads
from ..config import settings
from . import deps

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    """Endpoint for standard, non-streaming chat with intelligent routing and performance tracking."""
    if not deps.vector_store_service or not deps.generator_service or not deps.conversation_memory or not deps.query_router:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    # Initialize performance tracking
    start_time = time.time()
    metrics = RAGPerformanceMetrics(
        conversation_id="",
        query=request.message,
        query_type="",
        total_duration_ms=0,
        used_rag=False
    )

    try:
        # Conversation setup timing
        setup_start = time.time()
        conversation = deps.conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id
        metrics.conversation_id = conversation_id

        deps.conversation_memory.add_user_message(conversation_id, request.message)
        max_messages = deps.current_ui_settings.max_memory_messages if deps.current_ui_settings else 8
        conversation_context = deps.conversation_memory.get_conversation_context(conversation_id, max_messages=max_messages)
        setup_duration = (time.time() - setup_start) * 1000
        metrics.add_timing("conversation_setup", setup_duration)

        # Query routing timing with corpus context
        routing_start = time.time()
        context_fetch_start = routing_start
        routing_context = deps.vector_store_service.get_context_for_routing(request.message, max_samples=8)
        corpus_context = routing_context.documents
        context_duration = (time.time() - context_fetch_start) * 1000
        router_start = time.time()
        should_use_rag, confidence_score, routing_reason = deps.query_router.should_use_rag(
            request.message,
            conversation_context=conversation_context,
            corpus_sample=corpus_context
        )
        router_duration = (time.time() - router_start) * 1000
        routing_duration = context_duration + router_duration
        metrics.add_timing("query_routing", routing_duration, metadata={
            "confidence_score": confidence_score,
            "routing_reason": routing_reason,
            "context_docs_found": len(corpus_context),
            "context_strategy": routing_context.strategy,
            "context_ms": context_duration,
            "router_llm_ms": router_duration
        })

        metrics.used_rag = bool(should_use_rag)
        metrics.query_type = "rag" if should_use_rag else "direct"
        metrics.routing_similarity_score = confidence_score
        metrics.routing_reason = routing_reason

        logger.debug(
            "Query routing: '%s' -> RAG=%s (confidence=%.3f, reason=%s)",
            request.message[:50], should_use_rag, confidence_score, routing_reason
        )

        # Document retrieval timing (only if using RAG)
        context_chunks = []
        if should_use_rag:
            retrieval_start = time.time()
            context_chunks = await deps.vector_store_service.query_async(request.message, filters=request.filters)
            retrieval_duration = (time.time() - retrieval_start) * 1000
            metrics.add_timing("document_retrieval", retrieval_duration, metadata={
                "num_chunks_retrieved": len(context_chunks),
                "filters_applied": request.filters
            })
            metrics.num_context_chunks = len(context_chunks)
            logger.debug("RAG retrieval: found %d context chunks", len(context_chunks))
        else:
            metrics.add_timing("document_retrieval", 0, metadata={"skipped": True})
            logger.debug("Conversational routing: skipping document retrieval")

        # Response generation timing
        generation_start = time.time()
        response = deps.generator_service.ask(
            request.message,
            context_chunks,
            conversation_id=conversation_id,
            conversation_context=conversation_context,
            enforce_provenance=should_use_rag,
            persona=request.persona
        )
        generation_duration = (time.time() - generation_start) * 1000
        metrics.add_timing("response_generation", generation_duration, metadata={
            "enforce_provenance": bool(should_use_rag),
            "num_citations": len(response.citations),
            "response_length": len(response.response)
        })

        # Memory storage timing
        memory_start = time.time()
        deps.conversation_memory.add_assistant_message(
            conversation_id,
            response.response,
            response.citations,
            response.thinking
        )
        memory_duration = (time.time() - memory_start) * 1000
        metrics.add_timing("memory_storage", memory_duration)

        # Handle fallback logic (if needed)
        fallback_used = False
        if "couldn't find" in response.response.lower() and should_use_rag:
            logger.warning("RAG routing used but LLM returned fallback for query '%s'", request.message)

            fallback_start = time.time()
            conversational_response = deps.generator_service.ask(
                request.message,
                [],
                conversation_id=conversation_id,
                conversation_context=conversation_context,
                enforce_provenance=False,
                persona=request.persona
            )
            fallback_duration = (time.time() - fallback_start) * 1000

            if "couldn't find" not in conversational_response.response.lower():
                logger.info("Using conversational fallback for query '%s'", request.message)
                response = conversational_response
                fallback_used = True

                deps.conversation_memory.update_last_assistant_message(
                    conversation_id,
                    response.response,
                    response.citations,
                    response.thinking
                )

            metrics.add_timing("fallback_generation", fallback_duration, metadata={
                "fallback_used": fallback_used
            })
        elif not should_use_rag and len(response.response) > 50:
            logger.debug("Conversational routing successful for query '%s'", request.message[:50])

        # Calculate total duration and store metrics
        total_duration = (time.time() - start_time) * 1000
        metrics.total_duration_ms = total_duration
        metrics.filters_applied = request.filters
        metrics.used_rag = len(response.citations) > 0

        deps.store_performance_metrics(metrics)

        return response

    except Exception as e:
        error_duration = (time.time() - start_time) * 1000
        metrics.total_duration_ms = error_duration
        metrics.add_timing("error", 0, success=False, error_message=str(e))
        deps.store_performance_metrics(metrics)

        logger.error("Error during chat: %s", str(e))
        raise HTTPException(status_code=500, detail=f"Failed to process chat request: {e}")


@router.post("/chat/stream")
def chat_stream(request: ChatRequest):
    """Endpoint for streaming chat responses."""
    if not deps.vector_store_service or not deps.generator_service or not deps.conversation_memory or not deps.query_router:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    start_time = time.time()
    metrics = RAGPerformanceMetrics(
        conversation_id="",
        query=request.message,
        query_type="",
        total_duration_ms=0,
        used_rag=False
    )

    try:
        setup_start = time.time()
        conversation = deps.conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id
        metrics.conversation_id = conversation_id

        deps.conversation_memory.add_user_message(conversation_id, request.message)
        max_messages = deps.current_ui_settings.max_memory_messages if deps.current_ui_settings else 8
        conversation_context = deps.conversation_memory.get_conversation_context(conversation_id, max_messages=max_messages)
        setup_duration = (time.time() - setup_start) * 1000
        metrics.add_timing("conversation_setup", setup_duration)

        # Query routing
        routing_start = time.time()
        routing_context = deps.vector_store_service.get_context_for_routing(request.message, max_samples=8)
        corpus_context = routing_context.documents
        context_duration = (time.time() - routing_start) * 1000
        router_start = time.time()
        should_use_rag, confidence_score, routing_reason = deps.query_router.should_use_rag(
            request.message,
            conversation_context=conversation_context,
            corpus_sample=corpus_context
        )
        router_duration = (time.time() - router_start) * 1000
        routing_duration = context_duration + router_duration
        metrics.add_timing("query_routing", routing_duration, metadata={
            "should_use_rag": should_use_rag,
            "confidence_score": confidence_score,
            "routing_reason": routing_reason,
            "context_docs_found": len(corpus_context),
            "context_strategy": routing_context.strategy,
        })
        metrics.query_type = "rag" if should_use_rag else "direct"
        metrics.routing_similarity_score = confidence_score
        metrics.routing_reason = routing_reason

        # Document retrieval
        retrieval_start = time.time()
        if should_use_rag:
            context_chunks = deps.vector_store_service.query(request.message, filters=request.filters)
        else:
            context_chunks = []
        retrieval_duration = (time.time() - retrieval_start) * 1000
        metrics.add_timing("document_retrieval", retrieval_duration, metadata={
            "num_chunks": len(context_chunks),
            "used_rag": should_use_rag
        })
        metrics.num_context_chunks = len(context_chunks)
        metrics.used_rag = should_use_rag

        def generate():
            nonlocal metrics
            collected_response = ""
            generation_start = time.time()
            first_chunk_latency_ms: Optional[float] = None
            response_generation_timing: Optional[ComponentTiming] = None

            try:
                stream = deps.generator_service.ask_stream(
                    request.message,
                    context_chunks,
                    conversation_id=conversation_id,
                    conversation_context=conversation_context,
                    enforce_provenance=should_use_rag,
                    persona=request.persona
                )

                for chunk in stream:
                    if first_chunk_latency_ms is None:
                        first_chunk_latency_ms = (time.time() - generation_start) * 1000
                        metrics.add_timing(
                            "response_generation",
                            first_chunk_latency_ms,
                            metadata={
                                "streaming": True,
                                "first_chunk_latency_ms": first_chunk_latency_ms
                            }
                        )
                        response_generation_timing = metrics.component_timings[-1]
                    collected_response += chunk
                    yield chunk

                stream_state = getattr(stream, "state", {})
                thinking_text = stream_state.get("thinking", "") if isinstance(stream_state, dict) else ""

                # Generate citations
                citations = []
                if should_use_rag and context_chunks:
                    max_sources = min(len(context_chunks), settings.app_config.generation.max_citations)
                    quote_limit = settings.app_config.generation.quote_max_words
                    score_threshold = max(
                        0.0,
                        min(1.0, float(getattr(deps.generator_service, "citation_min_score_ratio", 0.0) or 0.0))
                    )
                    best_chunk = None
                    best_score = -1.0

                    for i, chunk in enumerate(context_chunks[:max_sources]):
                        normalized_score = getattr(chunk.metadata, "relevance_score_normalized", None)
                        raw_score = getattr(chunk.metadata, "relevance_score", None)
                        effective_score = (
                            float(normalized_score)
                            if normalized_score is not None
                            else float(raw_score) if raw_score is not None else 1.0
                        )

                        if effective_score > best_score:
                            best_score = effective_score
                            best_chunk = chunk

                        if score_threshold > 0 and normalized_score is not None and normalized_score < score_threshold:
                            continue

                        chunk_text = chunk.text
                        if chunk_text:
                            sentences = chunk_text.split(". ")
                            if len(sentences) > 1 and len(sentences[0]) <= quote_limit * 6:
                                quote = sentences[0] + "."
                            else:
                                words = chunk_text.split()[:quote_limit]
                                quote = " ".join(words) + ("..." if len(words) == quote_limit else "")
                        else:
                            quote = ""

                        citation = Citation(
                            id=str(uuid.uuid4()),
                            chunk_id=chunk.id,
                            page_title=chunk.metadata.page_title,
                            source_url=chunk.metadata.source_url,
                            url=chunk.metadata.url,
                            quote=quote,
                            space_name=chunk.metadata.space_name,
                            page_version=chunk.metadata.page_version
                        )
                        citations.append(citation)

                    if not citations and best_chunk is not None:
                        chunk_text = best_chunk.text
                        if chunk_text:
                            sentences = chunk_text.split(". ")
                            if len(sentences) > 1 and len(sentences[0]) <= quote_limit * 6:
                                quote = sentences[0] + "."
                            else:
                                words = chunk_text.split()[:quote_limit]
                                quote = " ".join(words) + ("..." if len(words) == quote_limit else "")
                        else:
                            quote = ""
                        citations.append(
                            Citation(
                                id=str(uuid.uuid4()),
                                chunk_id=best_chunk.id,
                                page_title=best_chunk.metadata.page_title,
                                source_url=best_chunk.metadata.source_url,
                                url=best_chunk.metadata.url,
                                quote=quote,
                                space_name=best_chunk.metadata.space_name,
                                page_version=best_chunk.metadata.page_version
                            )
                        )

                # Render citations
                citations_data = []
                rendered_citations_data = []

                for cite in citations:
                    cite_dict = cite.model_dump() if hasattr(cite, 'model_dump') else cite.__dict__
                    cite_dict['source_url'] = cite_dict.get('source_url') or cite_dict.get('url', '')
                    citations_data.append(cite_dict)

                if citations:
                    rendered_citations, citation_mapping = render_citation_payloads(citations)
                    rendered_citations_data = rendered_citations

                metadata = {
                    "citations": citations_data,
                    "rendered_citations": rendered_citations_data,
                    "conversation_id": conversation_id,
                    "thinking": thinking_text,
                }
                if citations_data or thinking_text:
                    yield f"\n---METADATA---{json.dumps(metadata)}---END---\n"

                # Update timing
                total_stream_duration_ms = (time.time() - generation_start) * 1000
                latency_ms = first_chunk_latency_ms if first_chunk_latency_ms is not None else total_stream_duration_ms

                if response_generation_timing is None:
                    metrics.add_timing(
                        "response_generation",
                        latency_ms,
                        metadata={
                            "streaming": True,
                            "first_chunk_latency_ms": latency_ms,
                            "total_stream_duration_ms": total_stream_duration_ms,
                            "response_length": len(collected_response),
                            "num_citations": len(citations),
                            "empty_stream": True
                        }
                    )
                else:
                    response_generation_timing.metadata.update({
                        "response_length": len(collected_response),
                        "num_citations": len(citations),
                        "total_stream_duration_ms": total_stream_duration_ms
                    })

                deps.conversation_memory.add_assistant_message(
                    conversation_id,
                    collected_response,
                    citations,
                    thinking_text
                )

                total_duration = (time.time() - start_time) * 1000
                metrics.total_duration_ms = total_duration
                deps.store_performance_metrics(metrics)

            except Exception as e:
                error_duration = (time.time() - generation_start) * 1000
                latency_ms = first_chunk_latency_ms if first_chunk_latency_ms is not None else error_duration

                if response_generation_timing is None:
                    metrics.add_timing(
                        "response_generation",
                        latency_ms,
                        success=False,
                        error_message=str(e),
                        metadata={"streaming": True}
                    )
                else:
                    response_generation_timing.success = False
                    response_generation_timing.error_message = str(e)

                total_duration = (time.time() - start_time) * 1000
                metrics.total_duration_ms = total_duration
                deps.store_performance_metrics(metrics)

                logger.error("Error during streaming: %s", str(e))
                yield f"Error: {str(e)}"

        return StreamingResponse(generate(), media_type="text/plain")

    except Exception as e:
        error_duration = (time.time() - start_time) * 1000
        metrics.total_duration_ms = error_duration
        metrics.add_timing("error", 0, success=False, error_message=str(e))
        deps.store_performance_metrics(metrics)

        logger.error("Error during streaming chat: %s", str(e))
        return StreamingResponse("Error processing request.", media_type="text/plain", status_code=500)


@router.post("/chat/direct")
def chat_direct(request: ChatRequest) -> ChatResponse:
    """Endpoint for direct LLM chat, bypassing all RAG components."""
    if not deps.generator_service or not deps.conversation_memory:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    start_time = time.time()
    metrics = RAGPerformanceMetrics(
        conversation_id="",
        query=request.message,
        query_type="direct_llm",
        total_duration_ms=0,
        used_rag=False
    )

    try:
        setup_start = time.time()
        conversation = deps.conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id
        metrics.conversation_id = conversation_id

        deps.conversation_memory.add_user_message(conversation_id, request.message)
        max_messages = deps.current_ui_settings.max_memory_messages if deps.current_ui_settings else 8
        conversation_context = deps.conversation_memory.get_conversation_context(conversation_id, max_messages=max_messages)
        setup_duration = (time.time() - setup_start) * 1000
        metrics.add_timing("conversation_setup", setup_duration)

        metrics.add_timing("query_routing", 0, metadata={"mode": "direct_llm", "skipped": True})
        metrics.add_timing("document_retrieval", 0, metadata={"mode": "direct_llm", "skipped": True})

        generation_start = time.time()
        response = deps.generator_service.ask(
            request.message,
            [],
            conversation_id=conversation_id,
            conversation_context=conversation_context,
            enforce_provenance=False,
            persona=request.persona
        )
        generation_duration = (time.time() - generation_start) * 1000
        metrics.add_timing("response_generation", generation_duration, metadata={
            "response_length": len(response.response),
            "mode": "direct_llm"
        })

        deps.conversation_memory.add_assistant_message(
            conversation_id,
            response.response,
            response.citations,
            response.thinking
        )

        total_duration = (time.time() - start_time) * 1000
        metrics.total_duration_ms = total_duration
        deps.store_performance_metrics(metrics)

        return ChatResponse(
            response=response.response,
            citations=response.citations or [],
            conversation_id=conversation_id,
            thinking=response.thinking
        )

    except Exception as e:
        logger.error("Direct chat error: %s", str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error processing direct chat request: {str(e)}")


@router.post("/chat/direct/stream")
def chat_direct_stream(request: ChatRequest):
    """Endpoint for streaming direct LLM chat, bypassing all RAG components."""
    if not deps.generator_service or not deps.conversation_memory:
        raise HTTPException(status_code=503, detail="Chat service not available.")

    start_time = time.time()
    metrics = RAGPerformanceMetrics(
        conversation_id="",
        query=request.message,
        query_type="direct_llm",
        total_duration_ms=0,
        used_rag=False
    )

    try:
        setup_start = time.time()
        conversation = deps.conversation_memory.get_or_create_conversation(request.conversation_id)
        conversation_id = conversation.conversation_id
        metrics.conversation_id = conversation_id

        deps.conversation_memory.add_user_message(conversation_id, request.message)
        max_messages = deps.current_ui_settings.max_memory_messages if deps.current_ui_settings else 8
        conversation_context = deps.conversation_memory.get_conversation_context(conversation_id, max_messages=max_messages)
        setup_duration = (time.time() - setup_start) * 1000
        metrics.add_timing("conversation_setup", setup_duration)

        metrics.add_timing("query_routing", 0, metadata={"mode": "direct_llm", "skipped": True})
        metrics.add_timing("document_retrieval", 0, metadata={"mode": "direct_llm", "skipped": True})

        def generate():
            nonlocal metrics
            collected_response = ""
            generation_start = time.time()

            try:
                stream = deps.generator_service.ask_stream(
                    request.message,
                    [],
                    conversation_id=conversation_id,
                    conversation_context=conversation_context,
                    enforce_provenance=False,
                    persona=request.persona
                )

                for chunk in stream:
                    collected_response += chunk
                    yield chunk

                stream_state = getattr(stream, "state", {})
                thinking_text = stream_state.get("thinking", "") if isinstance(stream_state, dict) else ""

                if thinking_text:
                    metadata = {
                        "citations": [],
                        "rendered_citations": [],
                        "conversation_id": conversation_id,
                        "thinking": thinking_text,
                    }
                    yield f"\n---METADATA---{json.dumps(metadata)}---END---\n"

                generation_duration = (time.time() - generation_start) * 1000
                metrics.add_timing("response_generation", generation_duration, metadata={
                    "response_length": len(collected_response),
                    "mode": "direct_llm"
                })

                deps.conversation_memory.add_assistant_message(
                    conversation_id,
                    collected_response,
                    [],
                    thinking_text
                )

                total_duration = (time.time() - start_time) * 1000
                metrics.total_duration_ms = total_duration
                deps.store_performance_metrics(metrics)

            except Exception as e:
                error_duration = (time.time() - generation_start) * 1000
                metrics.add_timing("response_generation", error_duration, success=False, error_message=str(e))

                total_duration = (time.time() - start_time) * 1000
                metrics.total_duration_ms = total_duration
                deps.store_performance_metrics(metrics)

                logger.error("Error during direct streaming: %s", str(e))
                yield f"Error: {str(e)}"

        return StreamingResponse(generate(), media_type="text/plain")

    except Exception as e:
        error_duration = (time.time() - start_time) * 1000
        metrics.total_duration_ms = error_duration
        metrics.add_timing("error", 0, success=False, error_message=str(e))
        deps.store_performance_metrics(metrics)

        logger.error("Direct streaming chat error: %s", str(e), exc_info=True)
        return StreamingResponse("Error processing direct request.", media_type="text/plain", status_code=500)
