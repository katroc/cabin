#!/usr/bin/env python3
"""
Test script for query routing functionality.
Tests the similarity-based routing to determine if queries need RAG or can be conversational.
"""

import requests
import json
from time import sleep

BASE_URL = "http://localhost:8788"

def test_query_routing():
    """Test the query routing system with different types of queries."""
    print("🎯 Testing Query Routing System...")

    # Test cases: (query, expected_routing, description)
    test_cases = [
        # Knowledge requests - should use RAG
        ("How do I configure SSL in the web server?", True, "Technical knowledge request"),
        ("What is the API endpoint for user management?", True, "API documentation request"),
        ("Where can I find the installation guide?", True, "Documentation location request"),

        # Conversational queries - should NOT use RAG
        ("Are you sure that's correct?", False, "Verification question"),
        ("Can you explain that differently?", False, "Clarification request"),
        ("What do you think about this approach?", False, "Opinion question"),

        # Follow-up queries - context dependent
        ("Tell me more about that", False, "Follow-up request"),
        ("Is there another way?", False, "Alternative inquiry"),
    ]

    print("\n📋 Testing different query types...")

    # Start a conversation to test conversational routing
    conversation_id = None

    for i, (query, expected_rag, description) in enumerate(test_cases, 1):
        print(f"\n{i}. Testing: {description}")
        print(f"   Query: '{query}'")

        # Make request
        response = requests.post(f"{BASE_URL}/api/chat", json={
            "message": query,
            "conversation_id": conversation_id
        })

        if response.status_code == 200:
            data = response.json()

            # Extract conversation_id for follow-up queries
            if conversation_id is None:
                conversation_id = data.get("conversation_id")

            # Analyze the response to infer routing decision
            response_text = data["response"]
            citations = data.get("citations", [])

            # Heuristic to determine if RAG was used
            used_rag = len(citations) > 0 or "I couldn't find" not in response_text

            print(f"   Expected RAG: {expected_rag}, Actual RAG: {used_rag}")
            print(f"   Citations: {len(citations)}")
            print(f"   Response: {response_text[:100]}...")

            if used_rag == expected_rag:
                print("   ✅ Routing correct!")
            else:
                print("   ⚠️  Routing mismatch - may need threshold tuning")

        else:
            print(f"   ❌ Request failed: {response.status_code}")

        sleep(0.5)  # Small delay between requests

def test_router_stats():
    """Test the router statistics endpoint."""
    print("\n📊 Testing Router Statistics...")

    try:
        response = requests.get(f"{BASE_URL}/api/query-router/stats")
        if response.status_code == 200:
            stats = response.json()
            print("✅ Router stats retrieved:")
            print(f"   BGE URL: {stats.get('bge_url')}")
            print(f"   Similarity threshold: {stats.get('similarity_threshold')}")
            print(f"   BGE available: {stats.get('is_available')}")
        else:
            print(f"❌ Failed to get router stats: {response.status_code}")
    except Exception as e:
        print(f"❌ Error getting router stats: {e}")

def test_conversation_stats():
    """Test conversation memory statistics."""
    print("\n💬 Testing Conversation Statistics...")

    try:
        response = requests.get(f"{BASE_URL}/api/conversations/stats")
        if response.status_code == 200:
            stats = response.json()
            print("✅ Conversation stats retrieved:")
            print(f"   Total conversations: {stats.get('total_conversations')}")
            print(f"   Total messages: {stats.get('total_messages')}")
        else:
            print(f"❌ Failed to get conversation stats: {response.status_code}")
    except Exception as e:
        print(f"❌ Error getting conversation stats: {e}")

def test_health_check():
    """Test if the server is running and healthy."""
    try:
        response = requests.get(f"{BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✅ Server is healthy and running")
            return True
        else:
            print(f"❌ Server health check failed: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Cannot connect to server: {e}")
        print(f"   Make sure the server is running on {BASE_URL}")
        return False

if __name__ == "__main__":
    print("🚀 Starting query routing tests...")

    if not test_health_check():
        print("\n💡 To start the server, run:")
        print("   cd packages/backend-python")
        print("   python -m src.cabin_backend.main")
        exit(1)

    # Run all tests
    test_query_routing()
    test_router_stats()
    test_conversation_stats()

    print("\n🎉 Query routing tests completed!")
    print("\n💡 Tips for tuning:")
    print("   - Check logs for routing decisions and similarity scores")
    print("   - Adjust similarity threshold in QueryRouter if needed")
    print("   - Monitor routing effectiveness over time")