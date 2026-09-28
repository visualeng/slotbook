// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Booking } from "../../src/shared/types";
import { MyBookings } from "../../src/web/components/MyBookings";
import { SelectionBar } from "../../src/web/components/SelectionBar";

afterEach(cleanup);

const booking: Booking = {
	id: "b1",
	resourceId: "r1",
	resourceName: "Переговорная «Кофе»",
	userId: "alice",
	day: "2026-09-28",
	startMinute: 540,
	endMinute: 600,
	title: "ревью",
	status: "CONFIRMED",
	createdAt: "2026-09-28T09:00:00.000Z",
};

describe("SelectionBar", () => {
	it("просит выбрать слот, пока ничего не выбрано", () => {
		render(
			<SelectionBar
				startMinute={null}
				endMinute={null}
				title=""
				busy={false}
				onTitleChange={() => {}}
				onSubmit={() => {}}
				onReset={() => {}}
			/>,
		);

		expect(screen.getByTestId("selection-empty")).toBeTruthy();
		expect(screen.queryByTestId("submit-booking")).toBeNull();
	});

	it("показывает границы выбранного интервала", () => {
		render(
			<SelectionBar
				startMinute={540}
				endMinute={660}
				title=""
				busy={false}
				onTitleChange={() => {}}
				onSubmit={() => {}}
				onReset={() => {}}
			/>,
		);

		expect(screen.getByTestId("selection-range").textContent).toBe("09:00–11:00");
	});

	it("передаёт заголовок и факт отправки", () => {
		const onTitleChange = vi.fn();
		const onSubmit = vi.fn();
		render(
			<SelectionBar
				startMinute={540}
				endMinute={570}
				title="планёрка"
				busy={false}
				onTitleChange={onTitleChange}
				onSubmit={onSubmit}
				onReset={() => {}}
			/>,
		);

		fireEvent.change(screen.getByTestId("title-input"), { target: { value: "не планёрка" } });
		fireEvent.click(screen.getByTestId("submit-booking"));

		expect(onTitleChange).toHaveBeenCalledWith("не планёрка");
		expect(onSubmit).toHaveBeenCalledOnce();
	});

	it("во время отправки кнопки заблокированы", () => {
		render(
			<SelectionBar
				startMinute={540}
				endMinute={570}
				title=""
				busy
				onTitleChange={() => {}}
				onSubmit={() => {}}
				onReset={() => {}}
			/>,
		);

		expect((screen.getByTestId("submit-booking") as HTMLButtonElement).disabled).toBe(true);
	});
});

describe("MyBookings", () => {
	it("пустой список объясняет, что брони нет", () => {
		render(<MyBookings bookings={[]} busy={false} onCancel={() => {}} />);
		expect(screen.getByTestId("mine-empty")).toBeTruthy();
	});

	it("показывает бронь и позволяет отменить", () => {
		const onCancel = vi.fn();
		render(<MyBookings bookings={[booking]} busy={false} onCancel={onCancel} />);

		expect(screen.getByText(/09:00–10:00 · Переговорная «Кофе» · ревью/)).toBeTruthy();
		fireEvent.click(screen.getByTestId("mine-cancel"));
		expect(onCancel).toHaveBeenCalledWith(booking);
	});
});
