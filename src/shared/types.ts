/**
 * Общие типы: их знает и сервер, и веб.
 *
 * День и время везде передаются строкой YYYY-MM-DD и целым числом минут от
 * начала суток — такой формат не тащит за собой проблем с таймзонами и
 * разбирается одинаково в TypeScript, SQL и в интерфейсе.
 */

export type BookingStatus = "CONFIRMED" | "CANCELLED";

/** Кто занял слот: свободен, занят кем-то другим или мой. */
export type SlotState = "FREE" | "BOOKED" | "MINE";

export type Resource = {
	id: string;
	name: string;
	slotMinutes: number;
	openMinute: number;
	closeMinute: number;
};

export type Booking = {
	id: string;
	resourceId: string;
	resourceName: string;
	userId: string;
	day: string;
	startMinute: number;
	endMinute: number;
	title: string;
	status: BookingStatus;
	createdAt: string;
};

export type ScheduleSlot = {
	startMinute: number;
	endMinute: number;
	state: SlotState;
	booking: Booking | null;
};

export type Schedule = {
	resource: Resource;
	day: string;
	viewer: string;
	slots: ScheduleSlot[];
};

/** События для /api/stream: веб перерисовывает сетку по ним. */
export type StreamEvent =
	| { type: "booking.created"; booking: Booking }
	| { type: "booking.cancelled"; booking: Booking };
