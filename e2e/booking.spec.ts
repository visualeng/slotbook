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

/**
 * Отменяет всё, что этот пользователь забронировал на текущем дне.
 * После клика список перерисовывается, поэтому следующий клик ждёт, пока
 * предыдущая отмена отразится в DOM, — иначе элемент уезжает из-под курсора.
 */
async function cancelMine(page: Page): Promise<void> {
	const items = page.getByTestId("mine-item");
	for (let guard = 0; guard < 10; guard += 1) {
		const before = await items.count();
		if (before === 0) {
			break;
		}
		await page.getByTestId("mine-cancel").first().click();
		await expect(items).toHaveCount(before - 1);
	}
	await expect(page.getByTestId("mine-empty")).toBeVisible();
}

function rowOf(page: Page, time: string): Locator {
	return page.locator("tr", { has: page.locator(`td.time:text-is("${time}")`) });
}

/** Время слота берём из ячейки в его же строке: у кнопки соседей нет. */
async function timeOf(slot: Locator): Promise<string> {
	return (await slot.locator("xpath=ancestor::tr").locator("td.time").textContent()) ?? "";
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

		// сосед занимает середину дня и держит бронь до конца теста
		await bookSlot(theirPage, theirPage.locator(DAY_SLOT).nth(1), "занято соседом");

		await openAs(page, viewer());
		await page.getByTestId("resource-select").selectOption({ index: resource.index });
		await expect(page.locator(SLOT).first()).toBeVisible();

		const free = page.locator(DAY_SLOT);
		// начинаем выбор с первого свободного слота, ничего не бронируя:
		// после успешной брони выбор сбрасывается и диапазон не собрать
		await free.first().click();
		await expect(page.getByTestId("selection-range")).toBeVisible();

		// последний свободный слот дня находится за занятым соседом: клик по
		// нему не должен собрать диапазон через него, а начать выбор заново
		const lastFree = free.last();
		const lastFreeTime = await timeOf(lastFree);
		await lastFree.click();

		await expect(page.getByTestId("notice")).toContainText("выбор начат заново");
		await expect(page.getByTestId("selection-range")).toHaveText(lastFreeTime);

		// выбор восстановился: этот слот бронируется как обычный одиночный
		await page.getByTestId("title-input").fill("одиночный слот");
		await page.getByTestId("submit-booking").click();
		await expect(page.getByTestId("notice")).toContainText("занято");
		await expect(page.locator(`${SLOT}[data-state="MINE"]`)).toHaveCount(1);

		await cancelMine(page);
		await cancelMine(theirPage);
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
		const targetTime = await timeOf(target);

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
