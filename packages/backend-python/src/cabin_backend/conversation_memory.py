"""Conversation memory management for per-conversation context."""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, Optional, List
from threading import Lock

from .models import ConversationHistory, ConversationMessage, Citation

logger = logging.getLogger(__name__)


class ConversationMemoryManager:
    """Manages conversation history and context for multiple conversations."""

    def __init__(self, max_conversations: int = 1000, cleanup_hours: int = 24):
        """
        Initialize conversation memory manager.

        Args:
            max_conversations: Maximum number of conversations to keep in memory
            cleanup_hours: Hours after which inactive conversations are cleaned up
        """
        self._conversations: Dict[str, ConversationHistory] = {}
        self._max_conversations = max_conversations
        self._cleanup_hours = cleanup_hours
        self._lock = Lock()

    def get_or_create_conversation(self, conversation_id: Optional[str] = None) -> ConversationHistory:
        """Get existing conversation or create a new one."""
        if conversation_id is None:
            conversation_id = str(uuid.uuid4())

        with self._lock:
            if conversation_id not in self._conversations:
                self._conversations[conversation_id] = ConversationHistory(
                    conversation_id=conversation_id
                )
                logger.debug("Created new conversation: %s", conversation_id)
            else:
                # Update access time
                self._conversations[conversation_id].updated_at = datetime.utcnow()

            # Cleanup old conversations if needed
            self._cleanup_old_conversations()

            return self._conversations[conversation_id]

    def add_user_message(self, conversation_id: str, message: str) -> ConversationMessage:
        """Add a user message to the conversation."""
        conversation = self.get_or_create_conversation(conversation_id)
        return conversation.add_message("user", message)

    def add_assistant_message(
        self,
        conversation_id: str,
        message: str,
        citations: List[Citation] = None
    ) -> ConversationMessage:
        """Add an assistant message to the conversation."""
        conversation = self.get_or_create_conversation(conversation_id)
        return conversation.add_message("assistant", message, citations or [])

    def get_conversation_context(
        self,
        conversation_id: str,
        max_messages: int = 10
    ) -> List[Dict[str, str]]:
        """Get conversation context for LLM processing."""
        conversation = self.get_or_create_conversation(conversation_id)
        return conversation.get_context_for_llm(max_messages)

    def get_conversation_history(self, conversation_id: str) -> Optional[ConversationHistory]:
        """Get full conversation history."""
        with self._lock:
            return self._conversations.get(conversation_id)

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation from memory."""
        with self._lock:
            if conversation_id in self._conversations:
                del self._conversations[conversation_id]
                logger.debug("Deleted conversation: %s", conversation_id)
                return True
            return False

    def get_conversation_count(self) -> int:
        """Get the current number of conversations in memory."""
        return len(self._conversations)

    def _cleanup_old_conversations(self) -> None:
        """Clean up old conversations based on age and count limits."""
        cutoff_time = datetime.utcnow() - timedelta(hours=self._cleanup_hours)

        # Remove conversations older than cutoff
        expired_ids = [
            conv_id for conv_id, conv in self._conversations.items()
            if conv.updated_at < cutoff_time
        ]

        for conv_id in expired_ids:
            del self._conversations[conv_id]
            logger.debug("Cleaned up expired conversation: %s", conv_id)

        # If still over limit, remove oldest conversations
        if len(self._conversations) > self._max_conversations:
            # Sort by last updated time and remove oldest
            sorted_conversations = sorted(
                self._conversations.items(),
                key=lambda x: x[1].updated_at
            )

            excess_count = len(self._conversations) - self._max_conversations
            for conv_id, _ in sorted_conversations[:excess_count]:
                del self._conversations[conv_id]
                logger.debug("Cleaned up excess conversation: %s", conv_id)

    def get_stats(self) -> Dict[str, any]:
        """Get memory manager statistics."""
        with self._lock:
            total_messages = sum(len(conv.messages) for conv in self._conversations.values())
            oldest_conversation = None
            newest_conversation = None

            if self._conversations:
                oldest = min(self._conversations.values(), key=lambda x: x.created_at)
                newest = max(self._conversations.values(), key=lambda x: x.created_at)
                oldest_conversation = oldest.created_at
                newest_conversation = newest.created_at

            return {
                "total_conversations": len(self._conversations),
                "total_messages": total_messages,
                "max_conversations": self._max_conversations,
                "cleanup_hours": self._cleanup_hours,
                "oldest_conversation": oldest_conversation,
                "newest_conversation": newest_conversation
            }

    def update_last_assistant_message(
        self,
        conversation_id: str,
        message: str,
        citations: List[Citation] = None
    ) -> bool:
        """Update the last assistant message in the conversation."""
        with self._lock:
            if conversation_id not in self._conversations:
                logger.warning("Cannot update message: conversation %s not found", conversation_id)
                return False

            conversation = self._conversations[conversation_id]

            # Find the last assistant message
            for i in range(len(conversation.messages) - 1, -1, -1):
                if conversation.messages[i].role == "assistant":
                    conversation.messages[i].content = message
                    conversation.messages[i].citations = citations or []
                    conversation.updated_at = datetime.utcnow()
                    logger.debug("Updated last assistant message in conversation %s", conversation_id)
                    return True

            logger.warning("No assistant message found to update in conversation %s", conversation_id)
            return False