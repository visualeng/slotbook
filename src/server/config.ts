/** Настройки из переменных окружения — без файлов конфигурации. */
import { resolve } from "node:path";

export type Config = {
	databaseUrl: string;
	databaseUser: string | undefined;
	databasePassword: string | undefined;
	port: number;
	/** Папка со собранным вебом: сервер отдаёт её статикой. */
	webDist: string;
	/** Папка миграций: по умолчанию — от текущего каталога. */
	migrationsDir: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const databaseUrl = env.DATABASE_URL ?? "";
	if (databaseUrl === "") {
		throw new Error("DATABASE_URL не задан: например postgres://localhost:5432/slotbook");
	}
	if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
		throw new Error(`DATABASE_URL должен начинаться с postgres:// — получено: ${databaseUrl}`);
	}

	const port = Number(env.PORT ?? "3000");
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`PORT некорректен: ${env.PORT}`);
	}

	return {
		databaseUrl,
		databaseUser: env.DATABASE_USER,
		databasePassword: env.DATABASE_PASSWORD,
		port,
		webDist: resolve(env.WEB_DIST ?? "dist/web"),
		migrationsDir: resolve(env.MIGRATIONS_DIR ?? "db/migrations"),
	};
}
