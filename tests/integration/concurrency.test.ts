/**
 * Гонки: смысл exclusion-ограничения в том, что результат не зависит от того,
 * кто первый успел дойти до базы. Эти тесты и есть доказательство.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import type { Db } from "../../src/server/db";
import { createEventBus } from "../../src/server/events";
import {
	COFFEE_ROOM,
	countConfirmed,
	describeWithDb,
	openTestDb,
	resetSchema,
	TEA_ROOM,
	testConfig,
} from "../helpers/db";

const DAY = "2026-09-28";

describeWithDb("конкурентные брони", () => {
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

	it("из десяти запросов на один слот проходит ровно один", async () => {
		const responses = await Promise.all(
			Array.from({ length: 10 }, (_unused, index) =>
				app.inject({
					method: "POST",
					url: "/api/bookings",
					payload: {
						resourceId: COFFEE_ROOM,
						userId: `user-${index}`,
						day: DAY,
						startMinute: 540,
						endMinute: 570,
					},
				}),
			),
		);

		const created = responses.filter((response) => response.statusCode === 201);
		const conflicted = responses.filter((response) => response.statusCode === 409);

		expect(created).toHaveLength(1);
		expect(conflicted).toHaveLength(9);
		expect(await countConfirmed(db)).toBe(1);
	});

	it("из параллельных броней одного человека выживает одна", async () => {
		// слоты пересекаются по времени, но лежат в разных ресурсах: мешает
		// ограничение на пользователя
		const responses = await Promise.all([
			app.inject({
				method: "POST",
				url: "/api/bookings",
				payload: {
					resourceId: COFFEE_ROOM,
					userId: "alice",
					day: DAY,
					startMinute: 600,
					endMinute: 660,
				},
			}),
			app.inject({
				method: "POST",
				url: "/api/bookings",
				payload: {
					resourceId: TEA_ROOM,
					userId: "alice",
					day: DAY,
					startMinute: 600,
					endMinute: 660,
				},
			}),
		]);

		expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
		expect(await countConfirmed(db)).toBe(1);
	});

	it("гонка брони и отмены заканчивается согласованным состоянием", async () => {
		// alice берёт слот, потом параллельно бронирует его же и отменяет свою
		const created = await app.inject({
			method: "POST",
			url: "/api/bookings",
			payload: {
				resourceId: COFFEE_ROOM,
				userId: "alice",
				day: DAY,
				startMinute: 540,
				endMinute: 570,
			},
		});
		const id = (created.json() as { id: string }).id;

		const [racing, cancel] = await Promise.all([
			app.inject({
				method: "POST",
				url: "/api/bookings",
				payload: {
					resourceId: COFFEE_ROOM,
					userId: "bob",
					day: DAY,
					startMinute: 540,
					endMinute: 570,
				},
			}),
			app.inject({ method: "DELETE", url: `/api/bookings/${id}?userId=alice` }),
		]);

		expect(cancel.statusCode).toBe(200);
		// либо bob успел до отмены (409) и слот освободился, либо выиграл после неё
		if (racing.statusCode === 201) {
			expect(await countConfirmed(db)).toBe(1);
		} else {
			expect(racing.statusCode).toBe(409);
			expect(await countConfirmed(db)).toBe(0);
		}

		const { rows } = await db.query<{ status: string }>(
			"SELECT status FROM bookings ORDER BY created_at",
		);
		expect(rows.filter((row) => row.status === "CONFIRMED").length).toBe(
			racing.statusCode === 201 ? 1 : 0,
		);
	});

	it("день заполняется целиком и второй круг уже не проходит", async () => {
		// 18 слотов по 30 минут с 09:00 до 18:00
		const attemptDay = async (): Promise<number[]> => {
			const statuses: number[] = [];
			for (let index = 0; index < 18; index += 1) {
				const start = 540 + index * 30;
				const response = await app.inject({
					method: "POST",
					url: "/api/bookings",
					payload: {
						resourceId: COFFEE_ROOM,
						userId: `user-${index}`,
						day: DAY,
						startMinute: start,
						endMinute: start + 30,
					},
				});
				statuses.push(response.statusCode);
			}
			return statuses;
		};

		expect(await attemptDay()).toEqual(Array.from({ length: 18 }, () => 201));
		expect(await attemptDay()).toEqual(Array.from({ length: 18 }, () => 409));
		expect(await countConfirmed(db)).toBe(18);
	});
});
