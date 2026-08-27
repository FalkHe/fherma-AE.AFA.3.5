"""`app/services/chat_response_service.py` — the one model call of a turn.

The in-memory `FakeAsyncSession` stands in for the database and a recording stub
for the chat model, so no gateway is ever dialled. What is under test is the
seam's contract: which messages one call receives (system prompt plus the
persisted timeline, body only) and that the reply is persisted through
`chat_service.append_assistant_message` — which ends the turn and announces it.
"""

import asyncio
from typing import Any

import pytest
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.core.config import get_settings
from app.db.models.chat import Chat, ChatMessage, ChatMessageRole
from app.db.models.operation import Operation, OperationStatus
from app.services import chat_response_service, chat_service, operation_service
from tests.services.conftest import FakeAsyncSession

USER_ID = "0" * 22 + "USER"


class StubModel:
    """Records the model id it was built for, the prompts it saw, and answers."""

    def __init__(self, answer: str = "Welcome! What will you use the bike for?") -> None:
        self.answer = answer
        self.requested: list[str | None] = []
        self.prompts: list[list[BaseMessage]] = []

    async def ainvoke(self, prompt: list[BaseMessage], **_kwargs: Any) -> AIMessage:
        self.prompts.append(list(prompt))
        return AIMessage(self.answer)


@pytest.fixture
def stub_model(monkeypatch: pytest.MonkeyPatch) -> StubModel:
    """Replace the chat-model factory the service imported by name."""
    model = StubModel()

    def factory(name: str | None = None) -> StubModel:
        model.requested.append(name)
        return model

    monkeypatch.setattr(chat_response_service, "get_chat_model", factory)
    return model


def _chat(session: FakeAsyncSession) -> Chat:
    return asyncio.run(chat_service.create_chat(session, USER_ID))


def _operation(session: FakeAsyncSession, chat: Chat) -> Operation:
    return asyncio.run(
        operation_service.create(
            session,
            chat_service.RESPONSE_OPERATION_TYPE,
            entity_type=operation_service.CHAT_ENTITY_TYPE,
            entity_id=chat.id,
        )
    )


def test_generate_persists_the_reply_and_ends_the_turn(
    fake_session: FakeAsyncSession, stub_model: StubModel
) -> None:
    chat = _chat(fake_session)
    operation = _operation(fake_session, chat)
    chat.active_operation_id = operation.id

    message = asyncio.run(chat_response_service.generate(fake_session, chat, operation))

    assert message.role is ChatMessageRole.ASSISTANT
    assert message.body == stub_model.answer
    assert fake_session.rows(ChatMessage) == [message]
    # `append_assistant_message` owns both: the pointer and the announcement.
    assert chat.active_operation_id is None
    announced = [payload for _channel, payload in fake_session.notifications]
    assert any("chat.message.created" in payload for payload in announced)
    # The greeting must not name the consultation.
    assert chat.title is None


def test_generate_asks_for_the_configured_advisor_model(
    fake_session: FakeAsyncSession, stub_model: StubModel
) -> None:
    """The model id is a configuration value, never a literal in the code."""
    chat = _chat(fake_session)

    asyncio.run(chat_response_service.generate(fake_session, chat, _operation(fake_session, chat)))

    assert stub_model.requested == [get_settings().advisor_model]


def test_generate_opens_the_conversation_when_the_timeline_is_empty(
    fake_session: FakeAsyncSession, stub_model: StubModel
) -> None:
    chat = _chat(fake_session)

    asyncio.run(chat_response_service.generate(fake_session, chat, _operation(fake_session, chat)))

    prompt = stub_model.prompts[0]
    # System prompt only: there is nothing yet to replay.
    assert len(prompt) == 1
    assert isinstance(prompt[0], SystemMessage)
    assert "open the conversation" in prompt[0].text.lower()


def test_generate_replays_the_whole_timeline_body_only(
    fake_session: FakeAsyncSession, stub_model: StubModel
) -> None:
    chat = _chat(fake_session)
    asyncio.run(chat_service.append_user_message(fake_session, chat, "I ride to work daily."))
    asyncio.run(
        chat_service.append_assistant_message(
            fake_session,
            chat,
            "How far is your commute?",
            tool_calls=[{"tool": "catalogue_search"}],
        )
    )
    asyncio.run(chat_service.append_user_message(fake_session, chat, "About 20 km."))

    asyncio.run(chat_response_service.generate(fake_session, chat, _operation(fake_session, chat)))

    prompt = stub_model.prompts[0]
    assert [type(message) for message in prompt] == [
        SystemMessage,
        HumanMessage,
        AIMessage,
        HumanMessage,
    ]
    assert [message.text for message in prompt[1:]] == [
        "I ride to work daily.",
        "How far is your commute?",
        "About 20 km.",
    ]
    # Past tool traffic is deliberately not replayed.
    assert "catalogue_search" not in "\n".join(message.text for message in prompt)
    assert "continue the interview" in prompt[0].text.lower()


def test_generate_refuses_to_store_an_empty_answer(
    fake_session: FakeAsyncSession, stub_model: StubModel
) -> None:
    """An empty bubble would look like a delivered answer; the job apologises instead."""
    stub_model.answer = "   \n "
    chat = _chat(fake_session)
    operation = _operation(fake_session, chat)
    chat.active_operation_id = operation.id

    with pytest.raises(chat_response_service.EmptyAnswerError):
        asyncio.run(chat_response_service.generate(fake_session, chat, operation))

    assert fake_session.rows(ChatMessage) == []
    assert chat.active_operation_id == operation.id
    assert operation.status is OperationStatus.QUEUED
