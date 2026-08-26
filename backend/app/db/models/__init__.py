"""SQLAlchemy models.

Importing this package must register every model on `Base.metadata`; Alembic's
`env.py` relies on that for autogenerate. Domain models arrive in later steps.
"""

from app.db.models.base import Base, ULIDPrimaryKeyMixin, new_ulid

__all__ = ["Base", "ULIDPrimaryKeyMixin", "new_ulid"]
