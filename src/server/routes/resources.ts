/** Ресурсы и их расписание. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BookingService } from "../domain/booking-service";

export const dayQuery = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "день должен быть в формате YYYY-MM-DD");

export function resourceRoutes(app: FastifyInstance, bookings: BookingService): void {
	app.get("/api/resources", async () => {
		return { items: await bookings.listResources() };
	});

	app.get("/api/resources/:id/schedule", async (request) => {
		const params = z.object({ id: z.string().uuid() }).parse(request.params);
		const query = z
			.object({ day: dayQuery, viewer: z.string().min(1).max(64).default("guest") })
			.parse(request.query);

		return bookings.schedule(params.id, query.day, query.viewer);
	});
}
