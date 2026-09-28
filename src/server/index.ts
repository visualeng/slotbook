/** Точка входа: конфиг, база, миграции, HTTP-сервер. */
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { createEventBus } from "./events";

async function main(): Promise<void> {
	const config = loadConfig();
	const db = createPool({
		connectionString: config.databaseUrl,
		user: config.databaseUser,
		password: config.databasePassword,
	});

	const applied = await migrate(db, config.migrationsDir);
	const events = createEventBus();
	const app = createApp({ db, events, config, logger: true });

	await app.listen({ port: config.port, host: "0.0.0.0" });
	app.log.info({ applied, port: config.port }, "slotbook готов");

	const shutdown = async (signal: string) => {
		app.log.info({ signal }, "останавливаюсь");
		await app.close();
		await db.end();
		process.exit(0);
	};

	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});
	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

main().catch((error: unknown) => {
	console.error("не удалось запуститься:", error);
	process.exit(1);
});
