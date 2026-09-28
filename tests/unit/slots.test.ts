import { describe, expect, it } from "vitest";
import {
	buildSlots,
	formatMinute,
	isAligned,
	isIsoDay,
	overlaps,
	overlayBookings,
	validateInterval,
} from "../../src/server/domain/slots";
import { ValidationError } from "../../src/server/errors";
import type { Resource } from "../../src/shared/types";

const coffee: Resource = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Переговорная «Кофе»",
	slotMinutes: 30,
	openMinute: 540,
	closeMinute: 1080,
};

describe("buildSlots", () => {
	it("режет рабочий день на слоты", () => {
		const slots = buildSlots(coffee);
		expect(slots).toHaveLength(18);
		expect(slots[0]).toEqual({ startMinute: 540, endMinute: 570 });
		expect(slots.at(-1)).toEqual({ startMinute: 1050, endMinute: 1080 });
	});

	it("не добавляет слот, вылезающий за закрытие", () => {
		// слот 45 минут: 540 + 45 * 11 = 1035, а 1080 - 1035 = 45 < 45
		const resource = { ...coffee, slotMinutes: 45, closeMinute: 1080 };
		const slots = buildSlots(resource);
		expect(slots.every((slot) => slot.endMinute <= resource.closeMinute)).toBe(true);
		expect(slots.at(-1)).toEqual({ startMinute: 1035, endMinute: 1080 });
	});

	it("пустой день без слотов, если слот длиннее рабочего дня", () => {
		expect(buildSlots({ ...coffee, slotMinutes: 600, closeMinute: 700 })).toEqual([]);
	});
});

describe("overlaps", () => {
	it("соседние интервалы не пересекаются", () => {
		expect(
			overlaps({ startMinute: 540, endMinute: 600 }, { startMinute: 600, endMinute: 660 }),
		).toBe(false);
	});

	it("вложенный интервал пересекается", () => {
		expect(
			overlaps({ startMinute: 540, endMinute: 660 }, { startMinute: 570, endMinute: 600 }),
		).toBe(true);
	});

	it("частичное пересечение с конца", () => {
		expect(
			overlaps({ startMinute: 540, endMinute: 600 }, { startMinute: 570, endMinute: 630 }),
		).toBe(true);
	});
});

describe("validateInterval", () => {
	it("принимает интервал по границам сетки", () => {
		expect(() => validateInterval(coffee, { startMinute: 540, endMinute: 630 })).not.toThrow();
	});

	it("отклоняет начало не по границе слота", () => {
		try {
			validateInterval(coffee, { startMinute: 545, endMinute: 575 });
			expect.unreachable("ожидалась ошибка not_aligned");
		} catch (error) {
			expect(error).toBeInstanceOf(ValidationError);
			expect((error as ValidationError).code).toBe("not_aligned");
		}
	});

	it("отклоняет интервал за пределами рабочего дня", () => {
		try {
			validateInterval(coffee, { startMinute: 1050, endMinute: 1110 });
			expect.unreachable("ожидалась ошибка outside_hours");
		} catch (error) {
			expect((error as ValidationError).code).toBe("outside_hours");
		}
	});

	it("отклоняет длину, не кратную слоту", () => {
		try {
			validateInterval(coffee, { startMinute: 540, endMinute: 585 });
			expect.unreachable("ожидалась ошибка invalid_interval");
		} catch (error) {
			expect((error as ValidationError).code).toBe("invalid_interval");
		}
	});

	it("отклоняет конец раньше начала", () => {
		expect(() => validateInterval(coffee, { startMinute: 600, endMinute: 600 })).toThrow(
			ValidationError,
		);
	});
});

describe("isAligned", () => {
	it("считает сетку от открытия, а не от полуночи", () => {
		// открытие в 09:20, слот 30 минут: 09:20 и 09:50 — границы, 09:30 — нет
		const resource = { ...coffee, openMinute: 560, closeMinute: 680 };
		expect(isAligned(resource, { startMinute: 560, endMinute: 590 })).toBe(true);
		expect(isAligned(resource, { startMinute: 590, endMinute: 620 })).toBe(true);
		expect(isAligned(resource, { startMinute: 570, endMinute: 600 })).toBe(false);
	});
});

describe("overlayBookings", () => {
	const slots = buildSlots(coffee);

	it("различает свои и чужие брони", () => {
		const result = overlayBookings(
			slots,
			[
				{ id: "a", startMinute: 540, endMinute: 570, userId: "alice" },
				{ id: "b", startMinute: 600, endMinute: 660, userId: "bob" },
			],
			"alice",
		);

		expect(result[0]?.state).toBe("MINE");
		expect(result[2]?.state).toBe("BOOKED");
		expect(result[2]?.booking?.userId).toBe("bob");
		expect(result[1]?.state).toBe("FREE");
		expect(result.at(-1)?.state).toBe("FREE");
	});

	it("длинная бронь закрывает все свои слоты", () => {
		const result = overlayBookings(
			slots,
			[{ id: "a", startMinute: 540, endMinute: 660, userId: "alice" }],
			"bob",
		);
		expect(result.slice(0, 4).every((slot) => slot.state === "BOOKED")).toBe(true);
		expect(result[4]?.state).toBe("FREE");
	});
});

describe("isIsoDay", () => {
	it("принимает настоящую дату", () => {
		expect(isIsoDay("2026-09-28")).toBe(true);
	});

	it("отклоняет 30 февраля и мусор", () => {
		expect(isIsoDay("2026-02-30")).toBe(false);
		expect(isIsoDay("28-09-2026")).toBe(false);
		expect(isIsoDay("")).toBe(false);
	});
});

describe("formatMinute", () => {
	it("печатает время с ведущими нулями", () => {
		expect(formatMinute(540)).toBe("09:00");
		expect(formatMinute(1439)).toBe("23:59");
	});
});
