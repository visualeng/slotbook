import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * e2e запускается против собранного приложения: тот же сервер отдаёт и API, и
 * статику, что и в проде. Локально поднимается автоматически, в CI — сервисом
 * джобы (PLAYWRIGHT_NO_SERVER=1), чтобы не было гонки со сборкой.
 */
export default defineConfig({
	testDir: "e2e",
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI === undefined ? "list" : "github",
	use: {
		baseURL,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer:
		process.env.PLAYWRIGHT_NO_SERVER === "1"
			? undefined
			: {
					command: "node dist/server/index.js",
					url: `${baseURL}/api/health`,
					reuseExistingServer: process.env.CI === undefined,
					timeout: 30_000,
					env: {
						DATABASE_URL: process.env.DATABASE_URL ?? "",
						DATABASE_USER: process.env.DATABASE_USER ?? "",
						DATABASE_PASSWORD: process.env.DATABASE_PASSWORD ?? "",
						PORT: new URL(baseURL).port || "3000",
					},
				},
});
