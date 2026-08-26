"""In-memory fake `AsyncSession` for `user_service`/`session_service` tests.

`StubSession` in the top-level `conftest.py` only records `execute()` calls for
route-level tests that never inspect a result. The auth services genuinely
read back what they write (uniqueness checks, session lookups, role-fresh
loads), so this fixture is a small in-memory store instead: it interprets the
handful of `select(...)`/`delete(...)` shapes the services actually issue
(single-column equality `where()`), without ever opening a real database
connection or event loop of its own — everything here is plain `async def`
called from the test's own `asyncio.run()`.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from sqlalchemy import Delete, Select

from app.db.models.base import new_ulid
from app.db.models.session import Session
from app.db.models.user import User


@dataclass
class _FakeResult:
    rows: list[Any]

    def scalar_one_or_none(self) -> Any | None:
        if not self.rows:
            return None
        assert len(self.rows) == 1, "fake store matched more than one row"
        return self.rows[0]


class FakeAsyncSession:
    """Interprets the exact `select`/`delete` shapes used by the services.

    Only single equality `where()` clauses on `select(User|Session)` and
    `delete(Session)` are supported — that is all the current services emit.
    A shape outside that raises `NotImplementedError` loudly rather than
    silently returning nothing, so a future service change that this fixture
    can't yet interpret fails fast instead of pretending to pass.
    """

    def __init__(self) -> None:
        self.users: dict[str, User] = {}
        self.sessions: dict[str, Session] = {}
        self.commit_count = 0
        self.deleted_objects: list[Any] = []

    def add(self, obj: User | Session) -> None:
        """Mimic ORM flush-time PK assignment, then insert into the store."""
        if getattr(obj, "id", None) is None:
            obj.id = new_ulid()
        if isinstance(obj, User):
            self.users[obj.id] = obj
        elif isinstance(obj, Session):
            self.sessions[obj.id] = obj
        else:  # pragma: no cover - defensive
            raise TypeError(f"FakeAsyncSession.add: unsupported type {type(obj)!r}")

    async def commit(self) -> None:
        self.commit_count += 1

    async def delete(self, obj: User | Session) -> None:
        self.deleted_objects.append(obj)
        if isinstance(obj, User):
            self.users.pop(obj.id, None)
        elif isinstance(obj, Session):
            self.sessions.pop(obj.id, None)

    async def execute(self, statement: object) -> _FakeResult:
        if isinstance(statement, Select):
            return self._execute_select(statement)
        if isinstance(statement, Delete):
            return self._execute_delete(statement)
        raise NotImplementedError(f"FakeAsyncSession.execute: unsupported statement {statement!r}")

    def _execute_select(self, statement: Select) -> _FakeResult:
        entity = statement.column_descriptions[0]["entity"]
        store = self.users if entity is User else self.sessions
        rows = self._filter(list(store.values()), statement.whereclause)
        return _FakeResult(rows)

    def _execute_delete(self, statement: Delete) -> _FakeResult:
        table_name = statement.table.name
        store = self.users if table_name == "users" else self.sessions
        matches = self._filter(list(store.values()), statement.whereclause)
        for obj in matches:
            store.pop(obj.id, None)
        return _FakeResult([])

    @staticmethod
    def _filter(rows: list[Any], whereclause: object) -> list[Any]:
        if whereclause is None:
            return rows
        column_name = whereclause.left.key
        value = whereclause.right.value
        return [row for row in rows if getattr(row, column_name) == value]


@pytest.fixture
def fake_session() -> Iterator[FakeAsyncSession]:
    yield FakeAsyncSession()
