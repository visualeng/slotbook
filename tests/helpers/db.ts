/** Общее для интеграционных тестов: пул, очистка схемы, фикстуры. */
import { resolve } from "node:path";
import { describe } from "vitest";
import type { Db } from "../../src/server/db";
import { createPool, migrate } from "../../src/server/db";
import type { Resource } from "../../src/shared/types";

/** Тесты с БД идут только когда указан TEST_DATABASE_URL — локально без Docker. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
export const describeWithDb = testDatabaseUrl === "" ? describe.skip : describe;

export const COFFEE_ROOM = "11111111-1111-4111-8111-111111111111";
export const TEA_ROOM = "22222222-2222-4222-8222-222222222222";

/** Конфиг для createApp: собранного веба нет, поэтому статика не поднимается. */
export function testConfig() {
	return {
		databaseUrl: "",
		databaseUser: undefined,
		databasePassword: undefined,
		port: 0,
		webDist: resolve("no-such-web-dist"),
		migrationsDir: resolve("db/migrations"),
	};
}

export async function openTestDb(): Promise<Db> {
	const db = createPool({
		connectionString: testDatabaseUrl,
		user: process.env.TEST_DATABASE_USER,
		password: process.env.TEST_DATABASE_PASSWORD,
	});
	await migrate(db, resolve("db/migrations"));
	return db;
}

/** Чистое состояние перед каждым тестом: таблицы пусты, ресурсы засеяны. */
export async function resetSchema(db: Db): Promise<void> {
	await db.query("TRUNCATE bookings, resources CASCADE");
	await db.query(
		`INSERT INTO resources (id, name, slot_minutes, open_minute, close_minute) VALUES
       ($1, 'Переговорная «Кофе»', 30, 540, 1080),
       ($2, 'Переговорная «Чай»',  60, 600, 1200)
     ON CONFLICT (id) DO NOTHING`,
		[COFFEE_ROOM, TEA_ROOM],
	);
}

export async function givenResource(
	db: Db,
	id: string,
	over: Partial<Omit<Resource, "id">> = {},
): Promise<Resource> {
	const resource: Resource = {
		id,
		name: over.name ?? `Ресурс ${id.slice(0, 4)}`,
		slotMinutes: over.slotMinutes ?? 30,
		openMinute: over.openMinute ?? 540,
		closeMinute: over.closeMinute ?? 1080,
	};
	await db.query(
		`INSERT INTO resources (id, name, slot_minutes, open_minute, close_minute)
     VALUES ($1, $2, $3, $4, $5)`,
		[resource.id, resource.name, resource.slotMinutes, resource.openMinute, resource.closeMinute],
	);
	return resource;
}

export type BookingFixture = {
	resourceId: string;
	userId: string;
	day: string;
	startMinute: number;
	endMinute: number;
	title?: string;
};

export async function givenBooking(db: Db, fixture: BookingFixture): Promise<string> {
	const { rows } = await db.query<{ id: string }>(
		`INSERT INTO bookings (id, resource_id, user_id, day, start_minute, end_minute, title)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
     RETURNING id`,
		[
			fixture.resourceId,
			fixture.userId,
			fixture.day,
			fixture.startMinute,
			fixture.endMinute,
			fixture.title ?? "",
		],
	);
	return (rows[0] as { id: string }).id;
}

export async function countConfirmed(db: Db): Promise<number> {
	const { rows } = await db.query<{ count: string }>(
		"SELECT count(*) AS count FROM bookings WHERE status = 'CONFIRMED'",
	);
	return Number((rows[0] as { count: string }).count);
}
