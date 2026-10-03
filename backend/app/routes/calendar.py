"""Calendar routes for MyGarage API."""

from datetime import date, timedelta
from decimal import Decimal
from io import StringIO
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import (
    InsurancePolicy,
    Reminder,
    ServiceVisit,
    Vehicle,
    WarrantyRecord,
)
from app.models.user import User
from app.schemas.calendar import CalendarEvent, CalendarResponse, CalendarSummary
from app.services.auth import require_auth, visible_vehicles_filter
from app.services.reminder_service import (
    DUE_SOON_WINDOW,
    calculate_driving_rate,
    calculate_hours_driving_rate,
    expected_due_date,
    get_current_hours,
    get_current_mileage,
    is_reminder_overdue,
    is_reminder_snoozed,
)
from app.utils.household_time import household_today

router = APIRouter(prefix="/api", tags=["calendar"])


UrgencyLevel = Literal["overdue", "high", "medium", "low", "historical"]

# Reminder event status per urgency; due_soon spans the DUE_SOON_WINDOW the
# card badge and hero counts use (calculate_urgency's "medium" ceiling).
_REMINDER_STATUS: dict[str, str] = {
    "overdue": "overdue",
    "high": "due_soon",
    "medium": "due_soon",
    "low": "on_track",
}


def calculate_urgency(
    event_date: date, is_overdue: bool, today: date | None = None
) -> UrgencyLevel:
    """Calculate urgency level based on date."""
    if is_overdue:
        return "overdue"

    days_until = (event_date - (today or household_today())).days

    if days_until <= 7:
        return "high"
    elif days_until <= DUE_SOON_WINDOW.days:
        return "medium"
    else:
        return "low"


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar_events(
    start_date: date | None = Query(None, description="Start date filter (default: 1 month ago)"),
    end_date: date | None = Query(None, description="End date filter (default: 1 year ahead)"),
    vehicle_vins: str | None = Query(None, description="Comma-separated VINs to filter by"),
    event_types: str | None = Query(
        None, description="Comma-separated event types (maintenance,insurance,warranty,service)"
    ),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    current_user: User | None = Depends(require_auth),
) -> CalendarResponse:
    """Get calendar events aggregated from maintenance schedule, insurance, and warranties."""

    # Set default date range if not provided
    if start_date is None:
        start_date = household_today() - timedelta(days=30)
    if end_date is None:
        end_date = household_today() + timedelta(days=365)

    # Parse filters
    vin_list = vehicle_vins.split(",") if vehicle_vins else None
    type_list = (
        event_types.split(",")
        if event_types
        else ["maintenance", "insurance", "warranty", "service"]
    )

    # Get vehicles scoped to current user (owned + shared), or all for admins
    vehicle_query = select(Vehicle)
    scope = visible_vehicles_filter(current_user)
    if scope is not None:
        vehicle_query = vehicle_query.where(scope)
    vehicles_result = await db.execute(vehicle_query)
    vehicles_dict = {v.vin: v for v in vehicles_result.scalars().all()}

    # Restrict all downstream queries to only the user's accessible vehicles
    allowed_vins = set(vehicles_dict.keys())
    if vin_list:
        # Further restrict by user-provided VIN filter
        allowed_vins = allowed_vins & set(vin_list)

    events = []
    today = household_today()

    # Fetch pending reminders for calendar
    if "maintenance" in type_list:
        reminder_query = select(Reminder).where(Reminder.status == "pending")

        if allowed_vins:
            reminder_query = reminder_query.where(Reminder.vin.in_(allowed_vins))
        else:
            reminder_query = reminder_query.where(Reminder.vin.in_([]))

        reminder_result = await db.execute(reminder_query)
        reminders = reminder_result.scalars().all()

        # Readings and rates once per vehicle, not per reminder (the inbox's
        # structure in routes/notifications.py): several usage reminders on
        # one vehicle would repeat identical queries otherwise.
        reminders_by_vin: dict[str, list[Reminder]] = {}
        for reminder in reminders:
            reminders_by_vin.setdefault(reminder.vin, []).append(reminder)

        for vin, vin_reminders in reminders_by_vin.items():
            vehicle = vehicles_dict.get(vin)
            needs_km = any(r.due_mileage_km is not None for r in vin_reminders)
            needs_hours = any(r.due_hours is not None for r in vin_reminders)
            current_odometer_km = await get_current_mileage(vin, db) if needs_km else None
            current_hours = await get_current_hours(vin, db) if needs_hours else None
            km_per_day = (
                await calculate_driving_rate(vin, db) if current_odometer_km is not None else None
            )
            hours_per_day = (
                await calculate_hours_driving_rate(vin, db) if current_hours is not None else None
            )

            for reminder in vin_reminders:
                due_mileage_km = reminder.due_mileage_km
                due_hours = reminder.due_hours

                # A reminder overdue by ANY set dimension (date, mileage,
                # hours) surfaces TODAY: the grid only fetches a few months
                # around the viewed one, so an event left on a long-past due
                # date falls out of the window and the reminder silently
                # vanishes (#195). A reminder past its mileage but not its
                # date would otherwise sit months ahead looking on_track
                # while the bell calls it overdue.
                if is_reminder_overdue(reminder, current_odometer_km, current_hours, today):
                    event_date = today
                    # The pin is the real state when the calendar date itself
                    # has passed; an estimate when only a usage target tripped.
                    is_estimated = not (reminder.due_date and reminder.due_date <= today)
                    urgency: UrgencyLevel = "overdue"
                else:
                    # Not overdue: the earliest expected date, exactly what
                    # the reminders list and the bell show (expected_due_date).
                    expected = expected_due_date(
                        reminder,
                        current_odometer_km,
                        current_hours,
                        km_per_day,
                        hours_per_day,
                        today,
                    )
                    if is_reminder_snoozed(reminder, today) and reminder.snoozed_until is not None:
                        # A snooze silences the nag, not the plan: a reminder
                        # still ahead keeps its expected date (decision 4 of
                        # the snooze plan: the calendar keeps showing it). One
                        # already due moves to the day the snooze ends (the
                        # list's "Snoozed until X" chip) instead of sitting on
                        # a long-past date outside the fetch window (#195).
                        event_date = (
                            expected
                            if expected is not None and expected >= today
                            else reminder.snoozed_until
                        )
                    elif expected is None:
                        # Skip if no date can be determined
                        continue
                    else:
                        event_date = expected
                    is_estimated = event_date != reminder.due_date
                    urgency = calculate_urgency(event_date, False, today)
                status = _REMINDER_STATUS[urgency]

                # Filter by date range
                if event_date < start_date or event_date > end_date:
                    continue

                days_until_due = (event_date - today).days

                km_until_due: Decimal | None = None
                if due_mileage_km is not None and current_odometer_km is not None:
                    km_until_due = due_mileage_km - current_odometer_km

                hours_until_due: Decimal | None = None
                if due_hours is not None and current_hours is not None:
                    hours_until_due = due_hours - current_hours

                events.append(
                    CalendarEvent(
                        id=f"reminder-{reminder.id}",
                        type="maintenance",
                        title=reminder.title,
                        description=f"Reminder ({reminder.reminder_type})",
                        date=event_date,
                        vehicle_vin=vin,
                        vehicle_nickname=vehicle.nickname if vehicle else None,
                        vehicle_color=None,
                        urgency=urgency,
                        is_recurring=False,
                        is_completed=False,
                        is_estimated=is_estimated,
                        category="maintenance",
                        notes=reminder.notes,
                        due_mileage_km=due_mileage_km,
                        due_hours=due_hours,
                        status=status,
                        days_until_due=days_until_due,
                        km_until_due=km_until_due,
                        hours_until_due=hours_until_due,
                        vehicle_distance_unit=vehicle.distance_unit if vehicle else None,
                    )
                )

    # Fetch insurance policies. A policy is a household record covering several
    # vehicles, so it is ONE event, anchored on the first covered vehicle the
    # caller may see that is still in service.
    if "insurance" in type_list:
        insurance_result = await db.execute(
            select(InsurancePolicy).where(
                InsurancePolicy.end_date >= start_date,
                InsurancePolicy.end_date <= end_date,
            )
        )
        renewed = set(
            (
                await db.execute(
                    select(InsurancePolicy.previous_policy_id).where(
                        InsurancePolicy.previous_policy_id.is_not(None)
                    )
                )
            )
            .scalars()
            .all()
        )

        for policy in insurance_result.scalars().unique().all():
            covered = [
                vehicles_dict[link.vin]
                for link in policy.vehicle_links
                if link.vin in allowed_vins and vehicles_dict[link.vin].archived_at is None
            ]
            if not covered:
                continue
            vehicle = covered[0]
            names = ", ".join(v.nickname or v.vin for v in covered)
            is_overdue = policy.end_date < today

            events.append(
                CalendarEvent(
                    id=f"insurance-{policy.id}",
                    type="insurance",
                    title=f"{policy.provider} Renewal",
                    description=f"Policy #{policy.policy_number} ({names})",
                    date=policy.end_date,
                    vehicle_vin=vehicle.vin,
                    vehicle_nickname=vehicle.nickname,
                    vehicle_color=None,
                    urgency=calculate_urgency(policy.end_date, is_overdue),
                    is_recurring=True,  # Insurance typically renews annually
                    # The next term or a new insurer is already entered.
                    is_completed=policy.id in renewed,
                    is_estimated=False,
                    category="legal",
                    notes=None,
                    due_mileage_km=None,
                    due_hours=None,
                )
            )

    # Fetch warranties
    if "warranty" in type_list:
        warranty_query = select(WarrantyRecord).where(
            WarrantyRecord.end_date.isnot(None),
            WarrantyRecord.end_date >= start_date,
            WarrantyRecord.end_date <= end_date,
        )

        if allowed_vins:
            warranty_query = warranty_query.where(WarrantyRecord.vin.in_(allowed_vins))
        else:
            warranty_query = warranty_query.where(WarrantyRecord.vin.in_([]))

        warranty_result = await db.execute(warranty_query)
        warranties = warranty_result.scalars().all()

        for warranty in warranties:
            vehicle = vehicles_dict.get(warranty.vin)
            is_overdue = bool(warranty.end_date and warranty.end_date < today)

            events.append(
                CalendarEvent(
                    id=f"warranty-{warranty.id}",
                    type="warranty",
                    title=f"{warranty.warranty_type} Warranty Expiration",
                    description=f"{warranty.provider or 'N/A'}"
                    + (f" - {warranty.policy_number}" if warranty.policy_number else ""),
                    date=warranty.end_date,
                    vehicle_vin=warranty.vin,
                    vehicle_nickname=vehicle.nickname if vehicle else None,
                    vehicle_color=None,
                    urgency=calculate_urgency(warranty.end_date, is_overdue),
                    is_recurring=False,
                    is_completed=False,
                    is_estimated=False,
                    category="legal",
                    notes=None,
                    due_mileage_km=None,
                    due_hours=None,
                )
            )

    # Fetch service history (past records only for historical context)
    if "service" in type_list:
        # NB: line_items only (reads scalars below). If a visit-level COST property
        # (subtotal / parts_supplies_cost / calculated_total_cost) is ever read here,
        # add `.selectinload(ServiceLineItem.supply_usages)` — the cost property
        # traverses supply_usages and MissingGreenlets on a shallow load.
        service_query = (
            select(ServiceVisit)
            .options(selectinload(ServiceVisit.line_items))
            .options(selectinload(ServiceVisit.vendor))
            .where(
                ServiceVisit.date >= start_date,
                ServiceVisit.date <= end_date,
            )
        )

        if allowed_vins:
            service_query = service_query.where(ServiceVisit.vin.in_(allowed_vins))
        else:
            service_query = service_query.where(ServiceVisit.vin.in_([]))

        service_result = await db.execute(service_query)
        visits = service_result.scalars().all()

        for visit in visits:
            vehicle = vehicles_dict.get(visit.vin)
            # Build title from first line item description, or notes, or category
            title = "Service"
            if visit.line_items:
                title = visit.line_items[0].description
            elif visit.notes:
                title = visit.notes

            vendor_name = visit.vendor.name if visit.vendor else None
            description = f"{visit.service_category or 'Service'}"
            if vendor_name:
                description += f" - {vendor_name}"

            events.append(
                CalendarEvent(
                    id=f"service-{visit.id}",
                    type="service",
                    title=title,
                    description=description,
                    date=visit.date,
                    vehicle_vin=visit.vin,
                    vehicle_nickname=vehicle.nickname if vehicle else None,
                    vehicle_color=None,
                    urgency="historical",  # Historical events don't have urgency
                    is_recurring=False,
                    is_completed=True,  # Service history is always completed
                    is_estimated=False,
                    category="history",
                    notes=visit.notes,
                    due_mileage_km=None,
                    due_hours=None,
                )
            )

    # Sort events by date
    events.sort(key=lambda e: e.date)

    # Calculate summary statistics
    overdue_count = sum(1 for e in events if e.urgency == "overdue")
    upcoming_7_count = sum(
        1
        for e in events
        if not e.is_completed and e.date >= today and e.date <= today + timedelta(days=7)
    )
    upcoming_30_count = sum(
        1
        for e in events
        if not e.is_completed and e.date >= today and e.date <= today + timedelta(days=30)
    )

    summary = CalendarSummary(
        total=len(events),
        overdue=overdue_count,
        upcoming_7_days=upcoming_7_count,
        upcoming_30_days=upcoming_30_count,
    )

    return CalendarResponse(events=events, summary=summary)


@router.get("/calendar/export")
async def export_calendar_ical(
    start_date: date | None = Query(None, description="Start date filter"),
    end_date: date | None = Query(None, description="End date filter"),
    vehicle_vins: str | None = Query(None, description="Comma-separated VINs"),
    event_types: str | None = Query(None, description="Comma-separated event types"),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    current_user: User | None = Depends(require_auth),
):
    """Export calendar events as iCal format."""
    # Get events using existing function logic
    calendar_response = await get_calendar_events(
        start_date=start_date,
        end_date=end_date,
        vehicle_vins=vehicle_vins,
        event_types=event_types,
        db=db,
        current_user=current_user,
    )

    # Generate iCal format
    ical = StringIO()
    ical.write("BEGIN:VCALENDAR\r\n")
    ical.write("VERSION:2.0\r\n")
    ical.write("PRODID:-//MyGarage//Vehicle Maintenance Calendar//EN\r\n")
    ical.write("CALSCALE:GREGORIAN\r\n")
    ical.write("X-WR-CALNAME:MyGarage Maintenance\r\n")
    ical.write("X-WR-TIMEZONE:UTC\r\n")

    for event in calendar_response.events:
        ical.write("BEGIN:VEVENT\r\n")
        ical.write(f"UID:{event.id}@mygarage.local\r\n")
        ical.write(f"DTSTART;VALUE=DATE:{event.date.strftime('%Y%m%d')}\r\n")
        ical.write(f"SUMMARY:{event.title}\r\n")

        if event.description:
            # Escape special characters in description
            desc = (
                event.description.replace("\\", "\\\\")
                .replace(",", "\\,")
                .replace(";", "\\;")
                .replace("\n", "\\n")
            )
            ical.write(f"DESCRIPTION:{desc}\r\n")

        # Add vehicle info to location
        vehicle_info = event.vehicle_nickname or event.vehicle_vin
        ical.write(f"LOCATION:{vehicle_info}\r\n")

        # Add category
        ical.write(f"CATEGORIES:{event.type.upper()}\r\n")

        # Add status based on completion
        if event.is_completed:
            ical.write("STATUS:COMPLETED\r\n")
        elif event.urgency == "overdue":
            ical.write("STATUS:CONFIRMED\r\n")
            ical.write("PRIORITY:1\r\n")  # High priority for overdue
        else:
            ical.write("STATUS:CONFIRMED\r\n")

        # Add recurrence rule if recurring
        if event.is_recurring:
            ical.write("RRULE:FREQ=YEARLY\r\n")  # Default to yearly

        ical.write("END:VEVENT\r\n")

    ical.write("END:VCALENDAR\r\n")

    return Response(
        content=ical.getvalue(),
        media_type="text/calendar",
        headers={
            "Content-Disposition": f"attachment; filename=mygarage-calendar-{household_today().strftime('%Y%m%d')}.ics"
        },
    )
