"""Source documents: the ingested prose behind one catalogue entry.

This module owns its transactions and speaks no HTTP. Documents are immutable
from the admin surface — they are written by ingestion and only ever read back.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.base import new_ulid
from app.db.models.source_document import SourceDocument, SourceType


async def create_document(
    session: AsyncSession,
    motorbike_id: str,
    *,
    source_type: SourceType,
    source_title: str,
    raw_path: str,
    content_markdown: str,
    fetched_at: datetime,
    source_url: str | None = None,
    document_id: str | None = None,
) -> SourceDocument:
    """Store one fetched document for `motorbike_id` and return the row.

    The payload is keyword-only: at seven fields, positional call sites in the
    ingestion job would be unreadable and easy to transpose.

    `document_id` lets the caller supply the id: the retained raw payload is
    named after the row (`storage.save_raw_document`), so the ingestion job
    generates the id before it writes the file and passes it in here. Omitted,
    the usual ULID default applies.
    """
    document = SourceDocument(
        id=document_id or new_ulid(),
        motorbike_id=motorbike_id,
        source_type=source_type,
        source_url=source_url,
        source_title=source_title,
        raw_path=raw_path,
        content_markdown=content_markdown,
        fetched_at=fetched_at,
    )
    session.add(document)
    await session.commit()
    return document


async def list_for_motorbike(session: AsyncSession, motorbike_id: str) -> list[SourceDocument]:
    """Return every document of `motorbike_id`, Wikipedia first, then oldest first.

    The review screen reads top to bottom, and the Wikipedia article is the one
    document that is always about the model itself rather than about a listing
    of it.
    """
    result = await session.execute(
        select(SourceDocument)
        .where(SourceDocument.motorbike_id == motorbike_id)
        .order_by(
            # `false` sorts before `true`, so the Wikipedia rows lead.
            SourceDocument.source_type != SourceType.WIKIPEDIA,
            SourceDocument.created_at,
        )
    )
    return list(result.scalars().all())
