/**
 * /api/stream — server-sent events.
 *
 * События нужны, чтобы два открытых браузера видели бронь друг друга сразу,
 * без опроса: дешевле и проще, чем WebSocket, а данных идёт немного.
 */
import type { FastifyInstance } from "fastify";
import type { StreamEvent } from "../../shared/types";
import type { EventBus } from "../events";

/** Прокси закрывают idle-соединения, поэтому шлём комментарий-пинг. */
const HEARTBEAT_MS = 25_000;

export function streamRoutes(app: FastifyInstance, events: EventBus): void {
	app.get("/api/stream", (request, reply) => {
		reply.raw.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		reply.raw.write(": connected\n\n");

		const send = (event: StreamEvent) => {
			reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
		};
		const unsubscribe = events.subscribe(send);
		const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), HEARTBEAT_MS);

		request.raw.on("close", () => {
			clearInterval(heartbeat);
			unsubscribe();
		});
	});
}
