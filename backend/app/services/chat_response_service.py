"""How the advisor answers one turn — the seam the agent loop replaces.

`generate` is the whole of a response turn: rebuild the conversation, ask the
model once, persist the reply. Step 3.13 rewrites the body of this one function
into the tool-calling loop (retrieval, tools, preferences, recommendations);
`app.jobs.chat` and the routes around it never change again, which is the point
of keeping it here rather than in the task.

Two rules live here:

* **The conversation is rebuilt from the database, not from a cache.** Every
  turn replays the persisted timeline (role and body only — past tool traffic is
  not replayed), so a worker restart, a second worker or a reload mid-answer all
  see the same history. Persistence *is* the resumability story.
* **The reply is persisted through `chat_service.append_assistant_message`**,
  which ends the turn (clears `active_operation_id`) and announces the message.
  Nothing here writes a message row or an event itself.

There is deliberately no retrieval and no tool in this step: the plain-LLM
greeting and reply are what step 3.5 promises, and the knowledge base enters
exactly once, in 3.13.
"""

import logging

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.models.chat import Chat, ChatMessage, ChatMessageRole
from app.db.models.operation import Operation
from app.llm.models import get_chat_model
from app.llm.prompts import render_prompt
from app.services import chat_service

logger = logging.getLogger(__name__)

# The advisor's persona, domain and refusal rules; `is_opening` switches the
# instruction for the greeting turn (an empty timeline).
SYSTEM_PROMPT = "advisor_system"


class EmptyAnswerError(RuntimeError):
    """The model returned no text at all.

    A dedicated failure rather than an empty bubble: the job turns any exception
    into the apologetic message, and an empty assistant message would look like
    a delivered answer while saying nothing.
    """

    def __init__(self) -> None:
        super().__init__("The advisor model returned an empty answer.")


async def generate(session: AsyncSession, chat: Chat, operation: Operation) -> ChatMessage:
    """Answer the current turn of `chat` and persist the reply.

    Args:
        session: Session the read and the write go through; the append commits.
        chat: The consultation being answered; its stored timeline is the context.
        operation: The `running` operation this turn reports into. Not written
            to here — the job owns the lifecycle — but named in the log, and the
            progress reports of step 3.13's loop go into it.

    Returns:
        The stored assistant message.

    Raises:
        EmptyAnswerError: The model answered with no text.
        MissingApiKeyError: `OPENROUTER_API_KEY` is not configured.
        Exception: Anything the gateway call raises reaches the caller — the job
            decides which failures are retried and which become an apology.
    """
    history = await chat_service.list_messages(session, chat.id)
    prompt = _build_prompt(history)

    model = get_chat_model(get_settings().advisor_model)
    logger.info(
        "chat %s: answering turn %s from %d stored message(s).",
        chat.id,
        operation.id,
        len(history),
    )
    answer = await model.ainvoke(prompt)

    body = answer.text.strip()
    if not body:
        raise EmptyAnswerError

    return await chat_service.append_assistant_message(session, chat, body)


def _build_prompt(history: list[ChatMessage]) -> list[BaseMessage]:
    """Turn the stored timeline into the messages one model call receives.

    The system prompt first, then the full history as Human/AI messages. Full
    replay, body only: a consultation is a bounded amount of text, and a
    summarisation step is added only if token limits actually bite.
    """
    messages: list[BaseMessage] = [
        SystemMessage(render_prompt(SYSTEM_PROMPT, is_opening=not history))
    ]
    for message in history:
        if message.role is ChatMessageRole.USER:
            messages.append(HumanMessage(message.body))
        else:
            messages.append(AIMessage(message.body))
    return messages
