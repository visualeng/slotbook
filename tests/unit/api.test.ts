/**
 * Клиент API: важно не то, что он красивый, а то, что он шлёт правильные
 * заголовки. Именно тут уже ловилась ошибка — DELETE с content-type и пустым
 * телом fastify отклоняет кодом 400.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Booking, Resource, Schedule } from "../../src/shared/types";
import { api, describeError, parseStreamEvent } from "../../src/web/api";

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

function respond(body: unknown, status = 200): Response {
	return { ok: status < 400, status, json: async () => body } as Response;
}

const resource: Resource = {
	id: "r1",
	name: "Кофе",
	slotMinutes: 30,
	openMinute: 540,
	closeMinute: 1080,
};

const booking: Booking = {
	id: "b1",
	resourceId: "r1",
	resourceName: "Кофе",
	userId: "alice",
	day: "2026-09-28",
	startMinute: 540,
	endMinute: 600,
	title: "",
	status: "CONFIRMED",
	createdAt: "2026-09-28T09:00:00.000Z",
};

function headersOf(call: Call | undefined): Record<string, string> {
	return (call?.init?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
	vi.unstubAllGlobals();
	calls = [];
});

describe("api", () => {
	it("POST брони несёт json", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, init });
				return respond(booking, 201);
			}),
		);

		const created = await api.create({
			resourceId: "r1",
			userId: "alice",
			day: "2026-09-28",
			startMinute: 540,
			endMinute: 600,
			title: "ревью",
		});

		expect(created.id).toBe("b1");
		expect(calls[0]?.url).toBe("/api/bookings");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(headersOf(calls[0])["content-type"]).toBe("application/json");
		expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ userId: "alice" });
	});

	it("DELETE отмены идёт без тела и без content-type", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, init });
				return respond({ ...booking, status: "CANCELLED" });
			}),
		);

		await api.cancel("b1", "alice");

		expect(calls[0]?.url).toBe("/api/bookings/b1?userId=alice");
		expect(calls[0]?.init?.method).toBe("DELETE");
		expect(calls[0]?.init?.body).toBeUndefined();
		expect(headersOf(calls[0])["content-type"]).toBeUndefined();
	});

	it("экранирует пользователя в адресе", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init?: RequestInit) => {
				calls.push({ url, init });
				return respond({});
			}),
		);

		await api.schedule("r1", "2026-09-28", "юзер из офиса").catch(() => undefined);

		expect(calls[0]?.url).toContain("viewer=%D1%8E%D0%B7%D0%B5%D1%80");
		expect(calls[0]?.url).toContain("day=2026-09-28");
	});

	it("ошибку сервера превращает в ApiError с кодом и деталями", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				respond(
					{
						code: "slot_taken",
						message: "слот уже занят",
						details: { conflicts: [booking] },
					},
					409,
				),
			),
		);

		const error = await api
			.create({
				resourceId: "r1",
				userId: "bob",
				day: "2026-09-28",
				startMinute: 540,
				endMinute: 570,
				title: "",
			})
			.catch((cause: unknown) => cause);

		expect(describeError(error)).toBe("слот уже занят");
		expect((error as { code: string }).code).toBe("slot_taken");
		expect((error as { details: { conflicts: Booking[] } }).details.conflicts).toHaveLength(1);
	});

	it("разбирает ресурсы и расписание", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url === "/api/resources") {
					return respond({ items: [resource] });
				}
				const schedule: Schedule = {
					resource,
					day: "2026-09-28",
					viewer: "alice",
					slots: [],
				};
				return respond(schedule);
			}),
		);

		expect(await api.resources()).toEqual([resource]);
		expect((await api.schedule("r1", "2026-09-28", "alice")).resource.id).toBe("r1");
	});
});

describe("parseStreamEvent", () => {
	it("принимает известные события", () => {
		const event = parseStreamEvent(JSON.stringify({ type: "booking.created", booking }));
		expect(event?.type).toBe("booking.created");
	});

	it("молча отбрасывает мусор и неизвестные типы", () => {
		expect(parseStreamEvent("не json")).toBeNull();
		expect(parseStreamEvent(JSON.stringify({ type: "что-то ещё" }))).toBeNull();
	});
});
