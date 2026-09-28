/** API целиком через inject(): те же роуты, что и в проде, но без сокета. */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import type { Db } from "../../src/server/db";
import { createEventBus } from "../../src/server/events";
import type { Booking, Resource, Schedule } from "../../src/shared/types";
import {
	COFFEE_ROOM,
	countConfirmed,
	describeWithDb,
	givenBooking,
	openTestDb,
	resetSchema,
	TEA_ROOM,
	testConfig,
} from "../helpers/db";

const DAY = "2026-09-28";

type BookingBody = {
	resourceId: string;
	userId: string;
	day: string;
	startMinute: number;
	endMinute: number;
	title?: string;
};

function body(over: Partial<BookingBody> = {}): BookingBody {
	return {
		resourceId: COFFEE_ROOM,
		userId: "alice",
		day: DAY,
		startMinute: 540,
		endMinute: 570,
		title: "",
		...over,
	};
}

type ErrorBody = { code: string; message: string; details: { conflicts?: Booking[] } | null };

describeWithDb("api", () => {
	let db: Db;
	let app: FastifyInstance;

	beforeAll(async () => {
		db = await openTestDb();
		app = createApp({ db, events: createEventBus(), config: testConfig() });
		await app.ready();
	});

	afterAll(async () => {
		await app.close();
		await db.end();
	});

	beforeEach(async () => {
		await resetSchema(db);
	});

	it("отвечает на healthz", async () => {
		const response = await app.inject({ url: "/api/health" });
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: "ok" });
	});

	it("отдаёт ресурсы с рабочими часами", async () => {
		const response = await app.inject({ url: "/api/resources" });
		const items = (response.json() as { items: Resource[] }).items;

		expect(response.statusCode).toBe(200);
		expect(items).toHaveLength(2);
		// ресурсы отдаются по имени: «Кофе» идёт раньше «Чая»
		expect(items.map((item) => [item.name, item.slotMinutes])).toEqual([
			["Переговорная «Кофе»", 30],
			["Переговорная «Чай»", 60],
		]);
	});

	it("считает сетку слотов на день", async () => {
		const response = await app.inject({
			url: `/api/resources/${COFFEE_ROOM}/schedule?day=${DAY}&viewer=alice`,
		});
		const schedule = response.json() as Schedule;

		expect(schedule.slots).toHaveLength(18);
		expect(schedule.slots.every((slot) => slot.state === "FREE")).toBe(true);
		expect(schedule.resource.name).toBe("Переговорная «Кофе»");
	});

	it("бронирует слот и помечает его своим", async () => {
		const created = await app.inject({
			method: "POST",
			url: "/api/bookings",
			payload: body({ title: "ревью" }),
		});
		expect(created.statusCode).toBe(201);
		const booking = created.json() as Booking;
		expect(booking.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(booking.resourceName).toBe("Переговорная «Кофе»");
		expect(booking.status).toBe("CONFIRMED");
		// день должен остаться строкой YYYY-MM-DD: по умолчанию pg отдаёт DATE
		// как Date по местному времени, и в UTC+3 он уезжает на сутки назад
		expect(booking.day).toBe(DAY);

		const mine = await app.inject({
			url: `/api/resources/${COFFEE_ROOM}/schedule?day=${DAY}&viewer=alice`,
		});
		const other = await app.inject({
			url: `/api/resources/${COFFEE_ROOM}/schedule?day=${DAY}&viewer=bob`,
		});

		expect(((mine.json() as Schedule).slots[0] as { state: string }).state).toBe("MINE");
		expect(((other.json() as Schedule).slots[0] as { state: string }).state).toBe("BOOKED");
	});

	it("не даёт занять чужой слот и говорит, кто занял", async () => {
		await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "bob",
			day: DAY,
			startMinute: 600,
			endMinute: 660,
		});

		const response = await app.inject({
			method: "POST",
			url: "/api/bookings",
			payload: body({ userId: "alice", startMinute: 630, endMinute: 690 }),
		});
		const error = response.json() as ErrorBody;

		expect(response.statusCode).toBe(409);
		expect(error.code).toBe("slot_taken");
		expect(error.details?.conflicts?.[0]?.userId).toBe("bob");
		expect(await countConfirmed(db)).toBe(1);
	});

	it("не даёт одному человеку быть в двух местах сразу", async () => {
		// alice заняла «Кофе», а «Чай» в это же время свободен: мешает только
		// ограничение на пользователя, а не на ресурс
		await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "alice",
			day: DAY,
			startMinute: 600,
			endMinute: 660,
		});

		const second = await app.inject({
			method: "POST",
			url: "/api/bookings",
			payload: body({ resourceId: TEA_ROOM, startMinute: 600, endMinute: 660 }),
		});
		const error = second.json() as ErrorBody;

		expect(second.statusCode).toBe(409);
		expect(error.code).toBe("user_busy");
		expect(error.details?.conflicts?.[0]?.resourceId).toBe(COFFEE_ROOM);
	});

	it("отменяет бронь и освобождает слот", async () => {
		const id = await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "alice",
			day: DAY,
			startMinute: 540,
			endMinute: 600,
		});

		const cancelled = await app.inject({
			method: "DELETE",
			url: `/api/bookings/${id}?userId=alice`,
		});
		expect(cancelled.statusCode).toBe(200);
		expect((cancelled.json() as Booking).status).toBe("CANCELLED");

		const schedule = await app.inject({
			url: `/api/resources/${COFFEE_ROOM}/schedule?day=${DAY}&viewer=alice`,
		});
		expect(
			((schedule.json() as Schedule).slots as { state: string }[])
				.slice(0, 2)
				.every((slot) => slot.state === "FREE"),
		).toBe(true);

		// освободившийся слот снова можно занять
		const again = await app.inject({ method: "POST", url: "/api/bookings", payload: body() });
		expect(again.statusCode).toBe(201);
	});

	it("не даёт отменить чужую бронь и не падает на повторной отмене", async () => {
		const id = await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "bob",
			day: DAY,
			startMinute: 540,
			endMinute: 570,
		});

		const foreign = await app.inject({ method: "DELETE", url: `/api/bookings/${id}?userId=alice` });
		expect(foreign.statusCode).toBe(409);
		expect((foreign.json() as ErrorBody).code).toBe("booking_owned_by_other");

		const own = await app.inject({ method: "DELETE", url: `/api/bookings/${id}?userId=bob` });
		expect(own.statusCode).toBe(200);

		const twice = await app.inject({ method: "DELETE", url: `/api/bookings/${id}?userId=bob` });
		expect(twice.statusCode).toBe(404);
	});

	it("фильтрует список по дню и пользователю", async () => {
		await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "alice",
			day: DAY,
			startMinute: 540,
			endMinute: 570,
		});
		await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "bob",
			day: DAY,
			startMinute: 600,
			endMinute: 630,
		});
		await givenBooking(db, {
			resourceId: COFFEE_ROOM,
			userId: "alice",
			day: "2026-09-29",
			startMinute: 540,
			endMinute: 570,
		});

		const day = await app.inject({ url: `/api/bookings?day=${DAY}` });
		const mine = await app.inject({ url: `/api/bookings?day=${DAY}&userId=alice` });

		expect((day.json() as { items: Booking[] }).items).toHaveLength(2);
		expect((mine.json() as { items: Booking[] }).items).toHaveLength(1);
	});

	it("не пускает брони мимо сетки слотов и рабочего дня", async () => {
		const cases: { payload: Partial<BookingBody>; code: string }[] = [
			{ payload: { startMinute: 545, endMinute: 575 }, code: "not_aligned" },
			{ payload: { startMinute: 1050, endMinute: 1110 }, code: "outside_hours" },
			{ payload: { startMinute: 540, endMinute: 545 }, code: "invalid_interval" },
			{ payload: { day: "28.09.2026" }, code: "validation_failed" },
			{ payload: { startMinute: -30, endMinute: 30 }, code: "validation_failed" },
		];

		for (const testCase of cases) {
			const response = await app.inject({
				method: "POST",
				url: "/api/bookings",
				payload: body(testCase.payload),
			});
			expect(response.statusCode, JSON.stringify(testCase.payload)).toBe(400);
			expect((response.json() as ErrorBody).code).toBe(testCase.code);
		}
		expect(await countConfirmed(db)).toBe(0);
	});

	it("возвращает 404 на неизвестный ресурс и несуществующий день", async () => {
		const missingResource = await app.inject({
			method: "POST",
			url: "/api/bookings",
			payload: body({ resourceId: "99999999-9999-4999-8999-999999999999" }),
		});
		expect(missingResource.statusCode).toBe(404);
		expect((missingResource.json() as ErrorBody).code).toBe("resource_not_found");

		const badDay = await app.inject({
			url: `/api/resources/${COFFEE_ROOM}/schedule?day=2026-02-30`,
		});
		expect(badDay.statusCode).toBe(400);
	});
});
