/** Подключение к Postgres и применение миграций при старте. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool, types } = pg;

// pg по умолчанию превращает колонку DATE в Date по местному времени: в
// UTC+3 полночь 28-го уезжает в toISOString() как 27-е число суток. Поэтому
// DATE оставляем строкой YYYY-MM-DD — арифметики с датами в проекте нет.
types.setTypeParser(1082, (value: string) => value);

export type Db = pg.Pool;

export type DbOptions = {
	connectionString: string;
	user: string | undefined;
	password: string | undefined;
};

/**
 * Собираем конфиг пула сами, а не отдаём DSN в pg: библиотека перекрывает
 * отдельные user/password значениями из самой строки подключения, а в разных
 * окружениях логин живёт то в URL, то в переменной. Поэтому: что есть в URL —
 * берём из URL, чего нет — из DATABASE_USER/DATABASE_PASSWORD.
 */
export function createPool({ connectionString, user, password }: DbOptions): Db {
	const url = new URL(connectionString);
	return new Pool({
		host: url.hostname,
		port: url.port === "" ? 5432 : Number(url.port),
		database: decodeURIComponent(url.pathname.replace(/^\//, "")),
		user: decodeURIComponent(url.username) === "" ? user : decodeURIComponent(url.username),
		password: decodeURIComponent(url.password) === "" ? password : decodeURIComponent(url.password),
		max: 10,
		idleTimeoutMillis: 30_000,
	});
}

/**
 * Миграции из db/migrations накатываются по порядку имени файла, каждый в
 * своей транзакции, применённые запоминаются в schema_migrations. Отдельного
 * инструмента миграций тут нет намеренно: их три штуки, и держать ради них
 * отдельный слой в проекте незачем.
 */
export async function migrate(db: Db, migrationsDir: string): Promise<string[]> {
	await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

	const { rows } = await db.query<{ name: string }>("SELECT name FROM schema_migrations");
	const applied = new Set(rows.map((row) => row.name));
	const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

	const fresh: string[] = [];
	for (const file of files) {
		if (applied.has(file)) {
			continue;
		}
		const sql = await readFile(join(migrationsDir, file), "utf8");
		const client = await db.connect();
		try {
			await client.query("BEGIN");
			await client.query(sql);
			await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
			await client.query("COMMIT");
			fresh.push(file);
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	return fresh;
}
