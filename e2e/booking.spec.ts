/**
 * Сценарии в браузере: ровно то, что делает человек — открыл, выбрал слот,
 * забронировал, отменил. Всё через интерфейс, без прямых вызовов API.
 *
 * Тесты не чистят базу (это чужая ответственность), поэтому каждый за собой
 * убирает: брони отменяются, а под состояние берётся отдельный ресурс.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const DAY_SLOT = 'button[data-testid="slot"][data-state="FREE"]';
const SLOT = 'button[data-testid="slot"]';

/** Имя пользователя уникально на запуск: база между прогонами не чистится. */
function viewer(): string {
	return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

async function openAs(page: Page, name: string): Promise<void> {
	await page.goto("/");
	await page.getByTestId("viewer-input").fill(name);
	await expect(page.locator(SLOT).first()).toBeVisible();
}

/** Отменяет всё, что этот пользователь забронировал на текущем дне. */
async function cancelMine(page: Page): Promise<void> {
	while ((await page.getByTestId("mine-cancel").count()) > 0) {
		await page.getByTestId("mine-cancel").first().click();
		await expect(page.getByTestId("mine-item")).toHaveCount(
			(await page.getByTestId("mine-cancel").count()) > 0 ? 1 : 0,
		);
	}
	await expect(page.getByTestId("mine-empty")).toBeVisible();
}

function rowOf(page: Page, time: string): Locator {
	return page.locator("tr", { has: page.locator(`td.time:text-is("${time}")`) });
}

async function bookSlot(page: Page, slot: Locator, title: string): Promise<void> {
	await slot.click();
	await expect(page.getByTestId("selection-range")).toBeVisible();
	await page.getByTestId("title-input").fill(title);
	await page.getByTestId("submit-booking").click();
	await expect(page.getByTestId("notice")).toContainText("занято");
}

test("слот бронируется и освобождается отменой", async ({ page }) => {
	await openAs(page, viewer());

	const free = page.locator(DAY_SLOT);
	const mine = page.locator(`${SLOT}[data-state="MINE"]`);
	const busy = page.locator(`${SLOT}[data-state="BOOKED"]`);
	const before = { mine: await mine.count(), busy: await busy.count() };

	await bookSlot(page, free.first(), "e2e-проверка");

	await expect(mine).toHaveCount(before.mine + 1);
	await expect(page.getByTestId("mine-item")).toHaveCount(1);

	await page.getByTestId("mine-cancel").click();

	await expect(page.getByTestId("notice")).toContainText("отменена");
	await expect(mine).toHaveCount(before.mine);
	await expect(page.getByTestId("mine-empty")).toBeVisible();
});

test("диапазон не перепрыгивает через занятый слот", async ({ page, browser }) => {
	// отдельный ресурс: тесты не должны зависеть от того, что наделал предыдущий
	const resource = { index: 1 };

	const theirContext = await browser.newContext();
	try {
		const theirPage = await theirContext.newPage();
		await openAs(theirPage, viewer());
		await theirPage.getByTestId("resource-select").selectOption({ index: resource.index });
		await expect(theirPage.locator(SLOT).first()).toBeVisible();

		// сосед занимает середину дня
		await bookSlot(theirPage, theirPage.locator(DAY_SLOT).nth(1), "занято соседом");
		const busyRow = theirPage
			.locator("tr", { has: theirPage.locator(`${SLOT}[data-state="MINE"]`) })
			.first();
		const busyTime = (await busyRow.locator("td.time").textContent()) ?? "";
		await theirPage.getByTestId("mine-cancel").click();
		await expect(theirPage.getByTestId("mine-empty")).toBeVisible();

		await openAs(page, viewer());
		await page.getByTestId("resource-select").selectOption({ index: resource.index });
		await expect(page.locator(SLOT).first()).toBeVisible();

		const free = page.locator(DAY_SLOT);
		await bookSlot(page, free.first(), "начинаю диапазон");
		// последний свободный слот дня находится за занятым
		await free.last().click();

		await expect(page.getByTestId("notice")).toContainText("выбор начат заново");
		await expect(page.getByTestId("selection-range")).not.toContainText(
			busyTime.split("–")[0] as string,
		);

		await cancelMine(page);
	} finally {
		await theirContext.close();
	}
});

test("чужая бронь приезжает в открытую страницу без перезагрузки", async ({ browser }) => {
	const mineContext = await browser.newContext();
	const theirContext = await browser.newContext();

	try {
		const theirPage = await theirContext.newPage();
		await openAs(theirPage, viewer());
		await expect(theirPage.getByTestId("live")).toHaveText("live");

		const target = theirPage.locator(DAY_SLOT).first();
		const targetTime =
			(await target.locator("xpath=preceding-sibling::td").first().textContent()) ?? "";

		const myPage = await mineContext.newPage();
		await openAs(myPage, viewer());
		await bookSlot(myPage, myPage.locator(DAY_SLOT).first(), "занял из другого окна");

		// страница наблюдателя обновляется через /api/stream, а не по кнопке
		await expect(rowOf(theirPage, targetTime).locator(SLOT)).toHaveAttribute(
			"data-state",
			"BOOKED",
			{ timeout: 10_000 },
		);

		await cancelMine(myPage);
	} finally {
		await mineContext.close();
		await theirContext.close();
	}
});
