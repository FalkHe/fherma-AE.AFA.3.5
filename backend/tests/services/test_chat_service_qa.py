"""QA additions to `app/services/chat_service.py`.

The dev agent's own `test_chat_service.py` already exhaustively covers
supersession, the title-once rule, the announce-after-commit ordering, message
ordering (incl. the ULID tiebreaker) and soft-delete visibility. This file only
adds the pinned edges that file leaves unexercised:

* `list_chats`'s secondary sort key — `id DESC` — is only exercised by the dev
  file through chats that also differ in `updated_at`; this proves the
  tiebreaker itself, for rows touched in the same instant.
* `append_assistant_message` bumps `updated_at` too (the dev file only proves
  this for `append_user_message`), since shared-knowledge pins it as "every
  message append", not just user ones.
* `get_owned_chat` returns `None` when a chat is *both* foreign and
  soft-deleted (the dev file proves each condition separately) — a
  security-critical existence-leak guard worth confirming directly rather than
  inferring from independent WHERE clauses.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from app.db.models.chat import Chat
from app.services import chat_service
from tests.services.conftest import FakeAsyncSession

USER_ID = "0" * 22 + "USER"
OTHER_USER_ID = "1" * 22 + "USER"


def test_list_chats_breaks_a_tied_updated_at_by_id_descending(
    fake_session: FakeAsyncSession,
) -> None:
    chats = [asyncio.run(chat_service.create_chat(fake_session, USER_ID)) for _ in range(3)]
    same_instant = datetime.now(UTC)
    for chat in chats:
        chat.updated_at = same_instant

    rows, total = asyncio.run(chat_service.list_chats(fake_session, USER_ID, limit=100, offset=0))

    assert [row.id for row in rows] == sorted((chat.id for chat in chats), reverse=True)
    assert total == 3


def test_append_assistant_message_also_bumps_last_activity(
    fake_session: FakeAsyncSession,
) -> None:
    chat = asyncio.run(chat_service.create_chat(fake_session, USER_ID))
    chat.updated_at = datetime.now(UTC) - timedelta(hours=1)

    asyncio.run(chat_service.append_assistant_message(fake_session, chat, "Hello there."))

    assert chat.updated_at > datetime.now(UTC) - timedelta(minutes=1)


def test_get_owned_chat_hides_a_soft_deleted_chat_even_for_a_foreign_owner(
    fake_session: FakeAsyncSession,
) -> None:
    """Belt-and-braces: the ownership *and* soft-delete filters combined still
    resolve to the same no-existence-leak `None`, not an exception or a hit."""
    chat = asyncio.run(chat_service.create_chat(fake_session, USER_ID))
    asyncio.run(chat_service.soft_delete_chat(fake_session, chat))

    assert asyncio.run(chat_service.get_owned_chat(fake_session, chat.id, OTHER_USER_ID)) is None
    assert asyncio.run(chat_service.get_owned_chat(fake_session, chat.id, USER_ID)) is None


def test_list_chats_still_excludes_a_soft_deleted_chat_among_live_ones(
    fake_session: FakeAsyncSession,
) -> None:
    live = asyncio.run(chat_service.create_chat(fake_session, USER_ID))
    deleted = asyncio.run(chat_service.create_chat(fake_session, USER_ID))
    asyncio.run(chat_service.soft_delete_chat(fake_session, deleted))

    rows, total = asyncio.run(chat_service.list_chats(fake_session, USER_ID, limit=100, offset=0))

    assert ([row.id for row in rows], total) == ([live.id], 1)


def test_a_message_body_is_stored_verbatim_not_only_the_truncated_title(
    fake_session: FakeAsyncSession,
) -> None:
    """Landed-decisions note: `append_user_message` stores `body` verbatim and
    only *derives* the (truncated) title from it — the message itself must
    not be truncated."""
    chat = asyncio.run(chat_service.create_chat(fake_session, USER_ID))
    long_body = "x" * 500

    message = asyncio.run(chat_service.append_user_message(fake_session, chat, long_body))

    assert message.body == long_body
    assert len(chat.title) == 160


def test_list_messages_has_no_pagination_parameters() -> None:
    """Landed-decisions note: `list_messages(session, chat_id)` is unpaginated
    by pin — confirm the signature carries no `limit`/`offset`."""
    import inspect

    parameters = inspect.signature(chat_service.list_messages).parameters
    assert set(parameters) == {"session", "chat_id"}


def test_chat_model_has_no_status_column() -> None:
    """Deliberate omission pinned in shared-knowledge: `deleted_at` is the
    only lifecycle flag."""
    assert "status" not in Chat.__table__.columns
