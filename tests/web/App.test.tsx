// @vitest-environment jsdom
/**
 * Тест на самую интересную часть интерфейса: выбор границ брони.
 * fetch и EventSource подменены, поэтому проверяется логика страницы целиком —
 * от клика по слоту до тела POST-запроса.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resource, Schedule, ScheduleSlot } from "../../src/shared/types";
import { App } from "../../src/web/App";

const resource: Resource = {
	id: "r1",
	name: "Переговорная «Кофе»",
	slotMinutes: 30,
	openMinute: 540,
	closeMinute: 660,
};

type FetchCall = { url: string; init: RequestInit | undefined };

let calls: FetchCall[] = [];
let booked: ScheduleSlot[] = [];

function slot(start: number, state: ScheduleSlot["state"] = "FREE"): ScheduleSlot {
	return {
		startMinute: start,
		endMinute: start + 30,
		state,
		booking:
			state === "FREE"
				? null
				: {
						id: `b-${start}`,
						resourceId: "r1",
						resourceName: resource.name,
						userId: "bob",
						day: "2026-09-28",
						startMinute: start,
						endMinute: start + 30,
						title: "планёрка",
						status: "CONFIRMED",
						createdAt: "2026-09-28T09:00:00.000Z",
					},
	};
}

function scheduleFor(): Schedule {
	return { resource, day: "2026-09-28", viewer: "alice", slots: booked };
}

function respond(body: unknown, status = 200): Response {
	return { ok: status < 400, status, json: async () => body } as Response;
}

class FakeEventSource {
	static last: FakeEventSource | null = null;
	onmessage: ((message: { data: string }) => void) | null = null;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;

	constructor(public url: string) {
		FakeEventSource.last = this;
	}

	close() {
		this.closed = true;
	}
}

beforeEach(() => {
	calls = [];
	booked = [slot(540), slot(570), slot(600), slot(630)];
	window.localStorage.clear();

	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init });

			if (url.startsWith("/api/resources/r1/schedule")) {
				return respond(scheduleFor());
			}
			if (url === "/api/resources") {
				return respond({ items: [resource] });
			}
			if (url.startsWith("/api/bookings?")) {
				return respond({ items: [] });
			}
			if (url === "/api/bookings" && init?.method === "POST") {
				return respond(
					{
						id: "new",
						resourceId: "r1",
						resourceName: resource.name,
						userId: "alice",
						day: "2026-09-28",
						startMinute: 540,
						endMinute: 570,
						title: "",
						status: "CONFIRMED",
						createdAt: "2026-09-28T09:00:00.000Z",
					},
					201,
				);
			}
			return respond({ code: "unexpected", message: url }, 500);
		}),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function freeSlotButtons(): HTMLButtonElement[] {
	return screen.getAllByTestId("slot") as HTMLButtonElement[];
}

describe("App", () => {
	it("показывает сетку и отмечается live после подписки на поток", async () => {
		render(<App />);
		await waitFor(() => expect(freeSlotButtons()).toHaveLength(4));

		expect(FakeEventSource.last?.url).toBe("/api/stream");
		act(() => FakeEventSource.last?.onopen?.());
		expect(screen.getByTestId("live").textContent).toBe("live");
	});

	it("собирает диапазон из двух кликов и уходит с ним в API", async () => {
		render(<App />);
		await waitFor(() => expect(freeSlotButtons()).toHaveLength(4));

		fireEvent.click(freeSlotButtons()[0] as HTMLButtonElement);
		expect(screen.getByTestId("selection-range").textContent).toBe("09:00–09:30");

		fireEvent.click(freeSlotButtons()[2] as HTMLButtonElement);
		expect(screen.getByTestId("selection-range").textContent).toBe("09:00–10:30");

		fireEvent.change(screen.getByTestId("title-input"), { target: { value: " ревью " } });
		fireEvent.click(screen.getByTestId("submit-booking"));

		await waitFor(() => {
			const post = calls.find((call) => call.init?.method === "POST");
			expect(post).toBeDefined();
			expect(JSON.parse(String(post?.init?.body))).toMatchObject({
				resourceId: "r1",
				startMinute: 540,
				endMinute: 630,
				title: "ревью",
			});
		});

		// после успеха выбор сбрасывается
		expect(screen.getByTestId("selection-empty")).toBeTruthy();
	});

	it("не даёт собрать диапазон через занятый слот", async () => {
		booked = [slot(540), slot(570, "BOOKED"), slot(600), slot(630)];
		render(<App />);
		await waitFor(() => expect(freeSlotButtons()).toHaveLength(4));

		fireEvent.click(freeSlotButtons()[0] as HTMLButtonElement);
		fireEvent.click(freeSlotButtons()[3] as HTMLButtonElement);

		expect(screen.getByTestId("notice").textContent).toContain("выбор начат заново");
		expect(screen.getByTestId("selection-range").textContent).toBe("10:30–11:00");
	});

	it("перезапрашивает расписание по чужому событию из потока", async () => {
		render(<App />);
		await waitFor(() => expect(freeSlotButtons()).toHaveLength(4));
		const before = calls.filter((call) => call.url.startsWith("/api/resources/r1/schedule")).length;

		FakeEventSource.last?.onmessage?.({
			data: JSON.stringify({
				type: "booking.created",
				booking: { id: "b", day: new Date().toISOString().slice(0, 10) },
			}),
		});

		await waitFor(() => {
			const after = calls.filter((call) =>
				call.url.startsWith("/api/resources/r1/schedule"),
			).length;
			expect(after).toBeGreaterThan(before);
		});
	});

	it("показывает ошибку от сервера", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				respond({ code: "slot_taken", message: "слот уже занят", details: null }, 409),
			),
		);
		render(<App />);
		await waitFor(() => expect(screen.getByTestId("error")).toBeTruthy());
		expect(screen.getByTestId("error").textContent).toBe("слот уже занят");
	});
});
