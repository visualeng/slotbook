/** Брони: список, создание, отмена. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BookingService, CreateBookingInput } from "../domain/booking-service";
import { dayQuery } from "./resources";

const createBody = z.object({
	resourceId: z.string().uuid(),
	userId: z.string().min(1).max(64),
	day: dayQuery,
	startMinute: z.number().int().min(0).max(1439),
	endMinute: z.number().int().min(1).max(1440),
	title: z.string().max(120).optional(),
});

export function bookingRoutes(app: FastifyInstance, bookings: BookingService): void {
	app.get("/api/bookings", async (request) => {
		const query = z
			.object({ day: dayQuery.optional(), userId: z.string().min(1).max(64).optional() })
			.parse(request.query);

		return { items: await bookings.listBookings(query) };
	});

	app.post("/api/bookings", async (request, reply) => {
		const body = createBody.parse(request.body) as CreateBookingInput;
		const created = await bookings.create(body);

		reply.code(201);
		return created;
	});

	app.delete("/api/bookings/:id", async (request) => {
		const params = z.object({ id: z.string().uuid() }).parse(request.params);
		const query = z.object({ userId: z.string().min(1).max(64) }).parse(request.query);

		return bookings.cancel(params.id, query.userId);
	});
}
