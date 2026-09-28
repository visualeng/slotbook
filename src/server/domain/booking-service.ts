/**
 * Брони: всё, что ходит в базу.
 *
 * Сервис не решает, «занято ли» — этим занимается exclusion-ограничение.
 * Здесь мы только переводим его нарушение в понятную 409 и подсказываем,
 * кому и когда слот занят.
 */
import type { Booking, Resource, Schedule, StreamEvent } from "../../shared/types";
import type { Db } from "../db";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import type { EventBus } from "../events";
import { buildSlots, isIsoDay, overlayBookings, validateInterval } from "./slots";

export type CreateBookingInput = {
	resourceId: string;
	userId: string;
	day: string;
	startMinute: number;
	endMinute: number;
	title?: string;
};

type ResourceRow = {
	id: string;
	name: string;
	slot_minutes: number;
	open_minute: number;
	close_minute: number;
};

type BookingRow = {
	id: string;
	resource_id: string;
	resource_name: string;
	user_id: string;
	// pg отдаёт DATE как Date — приводим к строке в normalizeDay
	day: Date | string;
	start_minute: number;
	end_minute: number;
	title: string;
	status: "CONFIRMED" | "CANCELLED";
	created_at: Date;
};

const BOOKING_COLUMNS = `
  b.id, b.resource_id, r.name AS resource_name, b.user_id, b.day,
  b.start_minute, b.end_minute, b.title, b.status, b.created_at`;

const BOOKING_JOINS = "FROM bookings b JOIN resources r ON r.id = b.resource_id";

function toResource(row: ResourceRow): Resource {
	return {
		id: row.id,
		name: row.name,
		slotMinutes: row.slot_minutes,
		openMinute: row.open_minute,
		closeMinute: row.close_minute,
	};
}

/**
 * pg отдаёт колонку DATE как Date (локальная полночь), и в JSON это уезжает
 * в UTC-полночь предыдущего дня. Поэтому день приводится к строке здесь, а не
 * в каждом месте ответа.
 */
function normalizeDay(value: Date | string): string {
	return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toBooking(row: BookingRow): Booking {
	return {
		id: row.id,
		resourceId: row.resource_id,
		resourceName: row.resource_name,
		userId: row.user_id,
		day: normalizeDay(row.day),
		startMinute: row.start_minute,
		endMinute: row.end_minute,
		title: row.title,
		status: row.status,
		createdAt: row.created_at.toISOString(),
	};
}

/** Postgres отдаёт дату строкой 'YYYY-MM-DD', время — числом. */
type PgError = { code?: string; constraint?: string };

function asPgError(error: unknown): PgError {
	return typeof error === "object" && error !== null ? (error as PgError) : {};
}

/** Значения, которые уходят в запрос параметрами $1, $2, … */
type Param = string | number | boolean | null;

export class BookingService {
	constructor(
		private readonly db: Db,
		private readonly events: EventBus,
	) {}

	async listResources(): Promise<Resource[]> {
		const { rows } = await this.db.query<ResourceRow>(
			"SELECT id, name, slot_minutes, open_minute, close_minute FROM resources ORDER BY name",
		);
		return rows.map(toResource);
	}

	async getResource(id: string): Promise<Resource> {
		const { rows } = await this.db.query<ResourceRow>(
			"SELECT id, name, slot_minutes, open_minute, close_minute FROM resources WHERE id = $1",
			[id],
		);
		const row = rows[0];
		if (!row) {
			throw new NotFoundError("resource_not_found", `ресурса ${id} нет`);
		}
		return toResource(row);
	}

	async listBookings(filter: { day?: string; userId?: string }): Promise<Booking[]> {
		const conditions: string[] = ["b.status = 'CONFIRMED'"];
		const args: Param[] = [];

		if (filter.day !== undefined) {
			this.assertDay(filter.day);
			args.push(filter.day);
			conditions.push(`b.day = $${args.length}`);
		}
		if (filter.userId !== undefined) {
			args.push(filter.userId);
			conditions.push(`b.user_id = $${args.length}`);
		}

		const { rows } = await this.db.query<BookingRow>(
			`SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS}
       WHERE ${conditions.join(" AND ")}
       ORDER BY b.day, b.start_minute`,
			args,
		);
		return rows.map(toBooking);
	}

	/** Сетка слотов на день: кто чем занят, с точки зрения конкретного пользователя. */
	async schedule(resourceId: string, day: string, viewer: string): Promise<Schedule> {
		this.assertDay(day);
		const resource = await this.getResource(resourceId);
		const { rows } = await this.db.query<BookingRow>(
			`SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS}
       WHERE b.resource_id = $1 AND b.day = $2 AND b.status = 'CONFIRMED'`,
			[resourceId, day],
		);
		const bookings = rows.map((row) => toBooking(row));
		return {
			resource,
			day,
			viewer,
			slots: overlayBookings(buildSlots(resource), bookings, viewer),
		};
	}

	async create(input: CreateBookingInput): Promise<Booking> {
		this.assertDay(input.day);
		const resource = await this.getResource(input.resourceId);
		validateInterval(resource, input);

		try {
			const { rows } = await this.db.query<BookingRow>(
				`INSERT INTO bookings (id, resource_id, user_id, day, start_minute, end_minute, title)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         RETURNING id, resource_id, user_id, day, start_minute, end_minute, title, status, created_at,
                   (SELECT name FROM resources WHERE id = $1) AS resource_name`,
				[
					input.resourceId,
					input.userId,
					input.day,
					input.startMinute,
					input.endMinute,
					input.title ?? "",
				],
			);
			const created = toBooking(rows[0] as BookingRow);
			this.events.publish({ type: "booking.created", booking: created } satisfies StreamEvent);
			return created;
		} catch (error) {
			const pg = asPgError(error);
			if (pg.code !== "23P01") {
				throw error;
			}
			throw await this.explainConflict(pg.constraint, input);
		}
	}

	async cancel(id: string, userId: string): Promise<Booking> {
		const { rows } = await this.db.query<BookingRow>(
			`SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS} WHERE b.id = $1 AND b.status = 'CONFIRMED'`,
			[id],
		);
		const row = rows[0];
		if (!row) {
			throw new NotFoundError("booking_not_found", `брони ${id} нет или она уже отменена`);
		}
		if (row.user_id !== userId) {
			throw new ConflictError("booking_owned_by_other", `бронь принадлежит ${row.user_id}`);
		}

		await this.db.query("UPDATE bookings SET status = 'CANCELLED' WHERE id = $1", [id]);
		const cancelled: Booking = { ...toBooking(row), status: "CANCELLED" };
		this.events.publish({ type: "booking.cancelled", booking: cancelled } satisfies StreamEvent);
		return cancelled;
	}

	/** Какое именно ограничение сработало — по нему понятно, что сообщать. */
	private async explainConflict(
		constraint: string | undefined,
		input: CreateBookingInput,
	): Promise<ConflictError> {
		if (constraint === "bookings_user_no_overlap") {
			const mine = await this.conflictingBookings("b.user_id = $1", [input.userId], input);
			return new ConflictError("user_busy", `у ${input.userId} уже есть бронь в это время`, {
				conflicts: mine,
			});
		}

		const busy = await this.conflictingBookings("b.resource_id = $1", [input.resourceId], input);
		return new ConflictError("slot_taken", "слот уже занят", { conflicts: busy });
	}

	private async conflictingBookings(
		where: string,
		args: Param[],
		input: CreateBookingInput,
	): Promise<Booking[]> {
		const { rows } = await this.db.query<BookingRow>(
			`SELECT ${BOOKING_COLUMNS} ${BOOKING_JOINS}
       WHERE ${where} AND b.status = 'CONFIRMED' AND b.day = $${args.length + 1}
         AND b.start_minute < $${args.length + 2} AND b.end_minute > $${args.length + 3}`,
			[...args, input.day, input.endMinute, input.startMinute],
		);
		return rows.map(toBooking);
	}

	private assertDay(day: string): void {
		if (!isIsoDay(day)) {
			throw new ValidationError("invalid_day", "день должен быть в формате YYYY-MM-DD");
		}
	}
}
