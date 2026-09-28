// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Resource, Schedule } from "../../src/shared/types";
import { ScheduleGrid } from "../../src/web/components/ScheduleGrid";

afterEach(cleanup);

const resource: Resource = {
	id: "r1",
	name: "Переговорная «Кофе»",
	slotMinutes: 30,
	openMinute: 540,
	closeMinute: 660,
};

function scheduleOf(slots: Schedule["slots"]): Schedule {
	return { resource, day: "2026-09-28", viewer: "alice", slots };
}

function free(start: number) {
	return { startMinute: start, endMinute: start + 30, state: "FREE" as const, booking: null };
}

describe("ScheduleGrid", () => {
	it("рисует слоты сетки и время", () => {
		render(
			<ScheduleGrid
				schedule={scheduleOf([free(540), free(570)])}
				anchor={null}
				rangeEnd={null}
				busy={false}
				onPick={() => {}}
				onCancel={() => {}}
			/>,
		);

		expect(screen.getAllByTestId("slot")).toHaveLength(2);
		expect(screen.getByText("09:00–09:30")).toBeTruthy();
	});

	it("отдаёт кликнутый слот наружу", () => {
		const onPick = vi.fn();
		render(
			<ScheduleGrid
				schedule={scheduleOf([free(540), free(570)])}
				anchor={null}
				rangeEnd={null}
				busy={false}
				onPick={onPick}
				onCancel={() => {}}
			/>,
		);

		fireEvent.click(screen.getAllByTestId("slot")[1] as HTMLElement);

		expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ startMinute: 570 }));
	});

	it("занятый слот кликом не берётся, а мою бронь можно отменить", () => {
		const onPick = vi.fn();
		const onCancel = vi.fn();
		const mine = {
			id: "b1",
			resourceId: "r1",
			resourceName: "Кофе",
			userId: "alice",
			day: "2026-09-28",
			startMinute: 570,
			endMinute: 600,
			title: "ревью",
			status: "CONFIRMED" as const,
			createdAt: "2026-09-28T09:00:00.000Z",
		};

		render(
			<ScheduleGrid
				schedule={scheduleOf([
					free(540),
					{ startMinute: 570, endMinute: 600, state: "MINE", booking: mine },
				])}
				anchor={null}
				rangeEnd={null}
				busy={false}
				onPick={onPick}
				onCancel={onCancel}
			/>,
		);

		const slots = screen.getAllByTestId("slot") as HTMLButtonElement[];
		expect(slots[1]?.disabled).toBe(true);
		expect(slots[1]?.textContent).toBe("моё");
		expect(screen.getByText("ревью")).toBeTruthy();

		fireEvent.click(screen.getByTestId("cancel-booking"));
		expect(onCancel).toHaveBeenCalledWith(mine);
	});

	it("подсвечивает выбранный диапазон", () => {
		const { container } = render(
			<ScheduleGrid
				schedule={scheduleOf([free(540), free(570), free(600)])}
				anchor={540}
				rangeEnd={600}
				busy={false}
				onPick={() => {}}
				onCancel={() => {}}
			/>,
		);

		expect(container.querySelectorAll("tr.selected")).toHaveLength(2);
	});

	it("во время запроса всё заблокировано", () => {
		render(
			<ScheduleGrid
				schedule={scheduleOf([free(540)])}
				anchor={null}
				rangeEnd={null}
				busy
				onPick={() => {}}
				onCancel={() => {}}
			/>,
		);

		expect((screen.getByTestId("slot") as HTMLButtonElement).disabled).toBe(true);
	});
});
