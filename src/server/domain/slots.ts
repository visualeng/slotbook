/**
 * Сетка слотов и проверки границ брони.
 *
 * Здесь нет ни базы, ни HTTP — только арифметика минут, поэтому всё это
 * проверяется обычными юнит-тестами.
 */
import type { Booking, Resource, SlotState } from "../../shared/types";
import { ValidationError } from "../errors";

export type Interval = { startMinute: number; endMinute: number };

export function buildSlots(resource: Resource): Interval[] {
	const slots: Interval[] = [];
	for (
		let start = resource.openMinute;
		start + resource.slotMinutes <= resource.closeMinute;
		start += resource.slotMinutes
	) {
		slots.push({ startMinute: start, endMinute: start + resource.slotMinutes });
	}
	return slots;
}

export function overlaps(a: Interval, b: Interval): boolean {
	// полуоткрытые интервалы: бронь 09:00–10:00 и 10:00–11:00 не пересекаются
	return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

export function isAligned(resource: Resource, interval: Interval): boolean {
	const relative = interval.startMinute - resource.openMinute;
	return relative >= 0 && relative % resource.slotMinutes === 0;
}

/**
 * Проверяет, что интервал вообще можно забронировать: начало и конец стоят
 * на границах сетки, внутри рабочего дня и не выходят за него.
 */
export function validateInterval(resource: Resource, interval: Interval): void {
	if (interval.startMinute >= interval.endMinute) {
		throw new ValidationError("invalid_interval", "начало должно быть раньше конца");
	}
	if (interval.startMinute < resource.openMinute || interval.endMinute > resource.closeMinute) {
		throw new ValidationError(
			"outside_hours",
			`рабочие часы ресурса: ${formatMinute(resource.openMinute)}–${formatMinute(resource.closeMinute)}`,
			{ openMinute: resource.openMinute, closeMinute: resource.closeMinute },
		);
	}
	if ((interval.endMinute - interval.startMinute) % resource.slotMinutes !== 0) {
		throw new ValidationError("invalid_interval", "интервал должен быть кратен слоту");
	}
	if (!isAligned(resource, interval)) {
		throw new ValidationError(
			"not_aligned",
			`начало должно совпадать с границей слота по ${resource.slotMinutes} минут`,
			{ slotMinutes: resource.slotMinutes },
		);
	}
}

/**
 * Наложить брони на сетку слотов: занятые помечаются своими или чужими.
 *
 * Дженерик по типу брони — чтобы функцией можно было пользоваться и с полными
 * Booking из базы, и с короткими объектами в юнит-тестах.
 */
export function overlayBookings<
	T extends Pick<Booking, "id" | "startMinute" | "endMinute" | "userId">,
>(
	slots: Interval[],
	bookings: T[],
	viewer: string,
): (Interval & { state: SlotState; booking: T | null })[] {
	return slots.map((slot) => {
		const booking = bookings.find((candidate) => overlaps(slot, candidate)) ?? null;
		return {
			...slot,
			state: booking === null ? "FREE" : booking.userId === viewer ? "MINE" : "BOOKED",
			booking,
		};
	});
}

export function formatMinute(minute: number): string {
	const hours = Math.floor(minute / 60);
	const rest = minute % 60;
	return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** YYYY-MM-DD → true, если такой день существует (2026-02-30 не проходит). */
export function isIsoDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
