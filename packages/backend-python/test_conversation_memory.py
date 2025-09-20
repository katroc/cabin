#!/usr/bin/env python3
"""
Test script for conversation memory functionality.
Run this to verify conversation history is working correctly.
"""

import requests
import json
import uuid
from time import sleep

BASE_URL = "http://localhost:8788"

def test_conversation_memory():
    """Test conversation memory functionality end-to-end."""
    print("🧪 Testing Conversation Memory...")

    # Test 1: Create a new conversation
    print("\n1. Testing new conversation creation...")
    response1 = requests.post(f"{BASE_URL}/api/chat", json={
        "message": "What is Python?",
        "conversation_id": None  # Should create new conversation
    })

    if response1.status_code == 200:
        data1 = response1.json()
        conversation_id = data1.get("conversation_id")
        print(f"✅ New conversation created: {conversation_id}")
        print(f"   Response: {data1['response'][:100]}...")
    else:
        print(f"❌ Failed to create conversation: {response1.status_code}")
        return False

    # Test 2: Continue conversation with context
    print("\n2. Testing conversation context...")
    response2 = requests.post(f"{BASE_URL}/api/chat", json={
        "message": "Can you give me a simple example?",
        "conversation_id": conversation_id
    })

    if response2.status_code == 200:
        data2 = response2.json()
        print(f"✅ Context-aware response received")
        print(f"   Response: {data2['response'][:100]}...")
    else:
        print(f"❌ Failed to continue conversation: {response2.status_code}")
        return False

    # Test 3: Get conversation history
    print("\n3. Testing conversation history retrieval...")
    history_response = requests.get(f"{BASE_URL}/api/conversations/{conversation_id}")

    if history_response.status_code == 200:
        history = history_response.json()
        message_count = len(history["messages"])
        print(f"✅ Retrieved conversation history with {message_count} messages")

        # Should have 4 messages: user1, assistant1, user2, assistant2
        if message_count >= 4:
            print("   ✅ Correct number of messages in history")
        else:
            print(f"   ⚠️  Expected at least 4 messages, got {message_count}")
    else:
        print(f"❌ Failed to get conversation history: {history_response.status_code}")
        return False

    # Test 4: Conversation stats
    print("\n4. Testing conversation statistics...")
    stats_response = requests.get(f"{BASE_URL}/api/conversations/stats")

    if stats_response.status_code == 200:
        stats = stats_response.json()
        print(f"✅ Stats retrieved: {stats['total_conversations']} conversations, {stats['total_messages']} messages")
    else:
        print(f"❌ Failed to get stats: {stats_response.status_code}")
        return False

    # Test 5: Delete conversation
    print("\n5. Testing conversation deletion...")
    delete_response = requests.delete(f"{BASE_URL}/api/conversations/{conversation_id}")

    if delete_response.status_code == 200:
        print("✅ Conversation deleted successfully")

        # Verify deletion
        verify_response = requests.get(f"{BASE_URL}/api/conversations/{conversation_id}")
        if verify_response.status_code == 404:
            print("✅ Confirmed conversation no longer exists")
        else:
            print("⚠️  Conversation still exists after deletion")
    else:
        print(f"❌ Failed to delete conversation: {delete_response.status_code}")
        return False

    print("\n🎉 All conversation memory tests passed!")
    return True

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
    print("🚀 Starting conversation memory tests...")

    if not test_health_check():
        print("\n💡 To start the server, run:")
        print("   cd packages/backend-python")
        print("   python -m src.cabin_backend.main")
        exit(1)

    if test_conversation_memory():
        print("\n✅ All tests completed successfully!")
        exit(0)
    else:
        print("\n❌ Some tests failed!")
        exit(1)