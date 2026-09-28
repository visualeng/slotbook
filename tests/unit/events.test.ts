import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../../src/server/events";

const booking = {
	id: "b1",
	resourceId: "r1",
	resourceName: "Кофе",
	userId: "alice",
	day: "2026-09-28",
	startMinute: 540,
	endMinute: 570,
	title: "",
	status: "CONFIRMED" as const,
	createdAt: "2026-09-28T10:00:00.000Z",
};

describe("createEventBus", () => {
	it("доставляет событие всем подписчикам", () => {
		const bus = createEventBus();
		const first = vi.fn();
		const second = vi.fn();
		bus.subscribe(first);
		bus.subscribe(second);

		bus.publish({ type: "booking.created", booking });

		expect(first).toHaveBeenCalledWith({ type: "booking.created", booking });
		expect(second).toHaveBeenCalledOnce();
		expect(bus.listenerCount()).toBe(2);
	});

	it("отписка останавливает доставку", () => {
		const bus = createEventBus();
		const listener = vi.fn();
		const unsubscribe = bus.subscribe(listener);
		unsubscribe();

		bus.publish({ type: "booking.cancelled", booking: { ...booking, status: "CANCELLED" } });

		expect(listener).not.toHaveBeenCalled();
		expect(bus.listenerCount()).toBe(0);
	});

	it("упавший подписчик не роняет остальных", () => {
		const bus = createEventBus();
		const healthy = vi.fn();
		bus.subscribe(() => {
			throw new Error("поток уже закрыт");
		});
		bus.subscribe(healthy);

		expect(() => bus.publish({ type: "booking.created", booking })).not.toThrow();
		expect(healthy).toHaveBeenCalledOnce();
		// сломанный подписчик отписан, чтобы не сыпать ошибками на каждый запрос
		expect(bus.listenerCount()).toBe(1);
	});
});
