/**
 * Сборка приложения: роуты, раздача собранного веба, единый формат ошибок.
 *
 * createApp вынесена отдельно от index.ts, чтобы тесты поднимали то же
 * самое приложение через inject(), без сокета и без процесса.
 */
import { existsSync } from "node:fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config";
import type { Db } from "./db";
import { BookingService } from "./domain/booking-service";
import { AppError } from "./errors";
import type { EventBus } from "./events";
import { bookingRoutes } from "./routes/bookings";
import { resourceRoutes } from "./routes/resources";
import { streamRoutes } from "./routes/stream";

export type AppDeps = {
	db: Db;
	events: EventBus;
	config: Config;
	logger?: boolean;
};

/** HTTP-статус, если ошибка им уже размечена (например, 404 от роутера). */
function statusCodeOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("statusCode" in error)) {
		return undefined;
	}
	const status = (error as { statusCode?: unknown }).statusCode;
	return typeof status === "number" ? status : undefined;
}

export function createApp({ db, events, config, logger = false }: AppDeps) {
	const app = Fastify({ logger });
	const bookings = new BookingService(db, events);

	app.get("/api/health", async () => {
		await db.query("SELECT 1");
		return { status: "ok", listeners: events.listenerCount() };
	});

	resourceRoutes(app, bookings);
	bookingRoutes(app, bookings);
	streamRoutes(app, events);

	app.setErrorHandler((error, request, reply) => {
		if (error instanceof AppError) {
			return reply
				.code(error.status)
				.send({ code: error.code, message: error.message, details: error.details ?? null });
		}
		if (error instanceof ZodError) {
			return reply.code(400).send({
				code: "validation_failed",
				message: "тело или параметры запроса не прошли проверку",
				details: error.issues.map((issue) => ({
					path: issue.path.join("."),
					message: issue.message,
				})),
			});
		}
		const status = statusCodeOf(error);
		if (status !== undefined && status < 500) {
			const message = error instanceof Error ? error.message : "запрос не прошёл проверку";
			return reply.code(status).send({ code: "bad_request", message });
		}

		request.log.error({ err: error }, "непойманная ошибка");
		return reply.code(500).send({ code: "internal_error", message: "внутренняя ошибка" });
	});

	// Собранный веб раздаётся тем же процессом: в проде это один контейнер.
	// В деве им занимается Vite с прокси на API, поэтому папки может не быть.
	if (existsSync(config.webDist)) {
		app.register(cors, { origin: true });
		app.register(fastifyStatic, { root: config.webDist });
		app.setNotFoundHandler((request, reply) => {
			if (request.url.startsWith("/api/")) {
				return reply.code(404).send({ code: "not_found", message: "нет такого маршрута" });
			}
			return reply.sendFile("index.html");
		});
	} else {
		app.log.info("собранный веб не найден — интерфейс отдаёт vite из dev-режима");
		app.setNotFoundHandler((request, reply) =>
			reply.code(404).send({ code: "not_found", message: `нет маршрута ${request.url}` }),
		);
	}

	return app;
}
