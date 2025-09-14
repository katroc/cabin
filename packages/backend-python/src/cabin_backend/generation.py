from typing import List, Iterator
import openai

from .config import settings
from .models import ParentChunk, ChatResponse

class Generator:
    def __init__(self):
        self.llm_client = openai.OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )

    def ask(self, query: str, context_chunks: List[ParentChunk]) -> ChatResponse:
        """Generates a standard, non-streaming response."""
        prompt = self._build_prompt(query, context_chunks)
        
        response = self.llm_client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ],
            stream=False,
        )
        
        answer = response.choices[0].message.content
        return ChatResponse(response=answer)

    def ask_stream(self, query: str, context_chunks: List[ParentChunk]) -> Iterator[str]:
        """Generates a streaming response."""
        prompt = self._build_prompt(query, context_chunks)

        stream = self.llm_client.chat.completions.create(
            model=settings.llm_model,
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ],
            stream=True,
        )

        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    def _build_prompt(self, query: str, context_chunks: List[ParentChunk]) -> str:
        """Builds the prompt for the LLM using the Gold Standard format."""
        print(f"DEBUG: Query: {query}")
        print(f"DEBUG: Found {len(context_chunks)} context chunks")
        for i, chunk in enumerate(context_chunks):
            print(f"DEBUG: Chunk {i}: {chunk.text[:100]}...")
            print(f"DEBUG: Chunk {i} metadata: {chunk.metadata}")

        context_str = ""
        for i, chunk in enumerate(context_chunks):
            context_str += f"Context from Confluence:\n"
            context_str += f"Page Title: {chunk.metadata.page_title}\n"
            if chunk.metadata.space_name:
                context_str += f"Space Name: {chunk.metadata.space_name}\n"
            if chunk.metadata.source_url:
                context_str += f"Source URL: {chunk.metadata.source_url}\n"
            if chunk.metadata.headings:
                context_str += f"Headings: {' > '.join(chunk.metadata.headings)}\n"
            context_str += f"---\n"
            context_str += f"{chunk.text}\n"
            context_str += f"---\n\n"

        prompt = f"""
Answer the question based *only* on the provided context from Confluence.

Format your response in markdown with:
- Use **bold** for important terms
- Use `code blocks` for technical terms or commands
- Use bullet points or numbered lists when appropriate
- Use headings (##, ###) to structure longer responses
- Include citations and source references

Context:
{context_str}

Question: {query}

Answer:
"""
        print(f"DEBUG: Full prompt:\n{prompt}")
        return prompt
