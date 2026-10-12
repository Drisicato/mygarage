"""Warranty record business logic service layer."""

import logging
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import WarrantyDocument
from app.models import WarrantyRecord as WarrantyRecordModel
from app.models.user import User
from app.schemas.warranty import (
    WarrantyDocumentResponse,
    WarrantyRecord,
    WarrantyRecordCreate,
    WarrantyRecordUpdate,
)
from app.services.file_upload_service import DOCUMENT_UPLOAD_CONFIG, FileUploadService
from app.utils.logging_utils import sanitize_for_log
from app.utils.path_validation import validate_path_within_base

logger = logging.getLogger(__name__)

MAX_DOCUMENTS_PER_WARRANTY = 10


def document_file(file_path: str) -> Path:
    """Absolute, validated location of a stored warranty document."""
    return validate_path_within_base(
        settings.documents_dir / file_path, settings.documents_dir, raise_error=True
    )


def _unlink_document(file_path: str) -> None:
    """Best-effort removal of a stored document; call only after the DB commit."""
    try:
        document_file(file_path).unlink(missing_ok=True)
    except OSError, HTTPException:
        logger.warning("Could not remove warranty document %s", sanitize_for_log(file_path))


class WarrantyService:
    """Service for managing warranty record business logic."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_warranties(
        self,
        vin: str,
        current_user: User | None,
        skip: int = 0,
        limit: int = 100,
    ) -> list[WarrantyRecord]:
        """Get all warranty records for a vehicle.

        Returns:
            List of warranty record responses.
        """
        from app.services.auth import get_vehicle_or_403

        vin = vin.upper().strip()

        try:
            await get_vehicle_or_403(vin, current_user, self.db)

            result = await self.db.execute(
                select(WarrantyRecordModel)
                .where(WarrantyRecordModel.vin == vin)
                .order_by(WarrantyRecordModel.start_date.desc())
                .offset(skip)
                .limit(limit)
            )
            records = result.scalars().all()

            return [WarrantyRecord.model_validate(r) for r in records]

        except HTTPException:
            raise
        except OperationalError as e:
            logger.error(
                "Database connection error listing warranties for %s: %s",
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    async def get_warranty(
        self, vin: str, warranty_id: int, current_user: User | None
    ) -> WarrantyRecord:
        """Get a specific warranty record by ID."""
        from app.services.auth import get_vehicle_or_403

        vin = vin.upper().strip()
        await get_vehicle_or_403(vin, current_user, self.db)

        result = await self.db.execute(
            select(WarrantyRecordModel).where(
                WarrantyRecordModel.vin == vin, WarrantyRecordModel.id == warranty_id
            )
        )
        record = result.scalar_one_or_none()

        if not record:
            raise HTTPException(status_code=404, detail=f"Warranty record {warranty_id} not found")

        return WarrantyRecord.model_validate(record)

    async def create_warranty(
        self, vin: str, data: WarrantyRecordCreate, current_user: User | None
    ) -> WarrantyRecord:
        """Create a new warranty record."""
        from app.services.auth import get_vehicle_or_403

        vin = vin.upper().strip()

        try:
            await get_vehicle_or_403(vin, current_user, self.db, require_write=True)

            record_dict = data.model_dump()
            record_dict["vin"] = vin

            record = WarrantyRecordModel(**record_dict)
            self.db.add(record)
            await self.db.commit()
            await self.db.refresh(record)

            logger.info(
                "Created warranty record %s for %s",
                record.id,
                sanitize_for_log(vin),
            )

            return WarrantyRecord.model_validate(record)

        except HTTPException:
            raise
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(
                "Database constraint violation creating warranty for %s: %s",
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=409, detail="Duplicate or invalid warranty record")
        except OperationalError as e:
            await self.db.rollback()
            logger.error(
                "Database connection error creating warranty for %s: %s",
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    async def update_warranty(
        self,
        vin: str,
        warranty_id: int,
        data: WarrantyRecordUpdate,
        current_user: User | None,
    ) -> WarrantyRecord:
        """Update an existing warranty record."""
        from app.services.auth import get_vehicle_or_403

        vin = vin.upper().strip()

        try:
            await get_vehicle_or_403(vin, current_user, self.db, require_write=True)

            result = await self.db.execute(
                select(WarrantyRecordModel).where(
                    WarrantyRecordModel.vin == vin, WarrantyRecordModel.id == warranty_id
                )
            )
            record = result.scalar_one_or_none()

            if not record:
                raise HTTPException(
                    status_code=404, detail=f"Warranty record {warranty_id} not found"
                )

            update_data = data.model_dump(exclude_unset=True)
            for field, value in update_data.items():
                setattr(record, field, value)

            await self.db.commit()
            await self.db.refresh(record)

            logger.info(
                "Updated warranty record %s for %s",
                warranty_id,
                sanitize_for_log(vin),
            )

            return WarrantyRecord.model_validate(record)

        except HTTPException:
            raise
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(
                "Database constraint violation updating warranty %s for %s: %s",
                warranty_id,
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=409, detail="Database constraint violation")
        except OperationalError as e:
            await self.db.rollback()
            logger.error(
                "Database connection error updating warranty %s for %s: %s",
                warranty_id,
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    async def _get_record_model(
        self, vin: str, warranty_id: int, current_user: User | None, *, write: bool
    ) -> WarrantyRecordModel:
        from app.services.auth import get_vehicle_or_403

        await get_vehicle_or_403(vin, current_user, self.db, require_write=write)
        result = await self.db.execute(
            select(WarrantyRecordModel).where(
                WarrantyRecordModel.vin == vin, WarrantyRecordModel.id == warranty_id
            )
        )
        record = result.scalar_one_or_none()
        if not record:
            raise HTTPException(status_code=404, detail=f"Warranty record {warranty_id} not found")
        return record

    async def add_document(
        self, vin: str, warranty_id: int, file: UploadFile, current_user: User | None
    ) -> WarrantyDocumentResponse:
        """Store an uploaded file on a warranty (PDF, Word/Excel, text, JPG, PNG)."""
        vin = vin.upper().strip()
        record = await self._get_record_model(vin, warranty_id, current_user, write=True)
        if len(record.documents) >= MAX_DOCUMENTS_PER_WARRANTY:
            raise HTTPException(
                status_code=400,
                detail=f"A warranty holds at most {MAX_DOCUMENTS_PER_WARRANTY} documents",
            )

        upload = await FileUploadService.upload_file(
            file, DOCUMENT_UPLOAD_CONFIG, subdirectory=f"{vin}/warranties/{warranty_id}"
        )
        relative = str(Path(upload.file_path).resolve().relative_to(settings.documents_dir.resolve()))
        document = WarrantyDocument(
            warranty_id=warranty_id,
            file_path=relative,
            file_name=(Path(file.filename or "").name or upload.filename)[:255],
            file_type=upload.content_type,
            file_size=upload.file_size,
        )
        self.db.add(document)
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            _unlink_document(relative)
            raise
        await self.db.refresh(document)
        logger.info("Added document %s to warranty %s", document.id, warranty_id)
        return WarrantyDocumentResponse.model_validate(document)

    async def get_document(
        self, vin: str, warranty_id: int, document_id: int, current_user: User | None
    ) -> WarrantyDocument:
        vin = vin.upper().strip()
        await self._get_record_model(vin, warranty_id, current_user, write=False)
        result = await self.db.execute(
            select(WarrantyDocument).where(
                WarrantyDocument.id == document_id, WarrantyDocument.warranty_id == warranty_id
            )
        )
        document = result.scalar_one_or_none()
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return document

    async def delete_document(
        self, vin: str, warranty_id: int, document_id: int, current_user: User | None
    ) -> None:
        vin = vin.upper().strip()
        await self._get_record_model(vin, warranty_id, current_user, write=True)
        document = await self.get_document(vin, warranty_id, document_id, current_user)
        file_path = document.file_path
        await self.db.delete(document)
        await self.db.commit()
        _unlink_document(file_path)

    async def delete_warranty(self, vin: str, warranty_id: int, current_user: User | None) -> None:
        """Delete a warranty record."""
        from app.services.auth import get_vehicle_or_403

        vin = vin.upper().strip()

        try:
            await get_vehicle_or_403(vin, current_user, self.db, require_write=True)

            result = await self.db.execute(
                select(WarrantyRecordModel).where(
                    WarrantyRecordModel.vin == vin, WarrantyRecordModel.id == warranty_id
                )
            )
            record = result.scalar_one_or_none()

            if not record:
                raise HTTPException(
                    status_code=404, detail=f"Warranty record {warranty_id} not found"
                )

            document_paths = [d.file_path for d in record.documents]
            # Explicit, so the rows go whether or not the database enforces the cascade.
            await self.db.execute(
                delete(WarrantyDocument).where(WarrantyDocument.warranty_id == warranty_id)
            )
            await self.db.execute(
                delete(WarrantyRecordModel).where(
                    WarrantyRecordModel.vin == vin, WarrantyRecordModel.id == warranty_id
                )
            )
            await self.db.commit()
            for path in document_paths:
                _unlink_document(path)

            logger.info(
                "Deleted warranty record %s for %s",
                warranty_id,
                sanitize_for_log(vin),
            )

        except HTTPException:
            raise
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(
                "Database constraint violation deleting warranty %s for %s: %s",
                warranty_id,
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=409, detail="Cannot delete record with dependent data")
        except OperationalError as e:
            await self.db.rollback()
            logger.error(
                "Database connection error deleting warranty %s for %s: %s",
                warranty_id,
                sanitize_for_log(vin),
                sanitize_for_log(e),
            )
            raise HTTPException(status_code=503, detail="Database temporarily unavailable")
