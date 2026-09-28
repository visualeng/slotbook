/** Тонкий клиент API: типовые ошибки приводит к ApiError с кодом от сервера. */
import type { Booking, Resource, Schedule, StreamEvent } from "../shared/types";

export type ApiError = Error & { code: string; details: unknown };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	// content-type ставим только когда тело действительно есть: fastify отвечает
	// 400 на запрос с content-type: application/json и пустым телом, а DELETE
	// отправляется как раз без тела
	const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
	if (init?.body !== undefined && headers["content-type"] === undefined) {
		headers["content-type"] = "application/json";
	}

	const response = await fetch(path, { ...init, headers });

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as {
			code: string;
			message: string;
			details: unknown;
		} | null;
		const error = new Error(body?.message ?? `HTTP ${response.status}`) as ApiError;
		error.code = body?.code ?? "http_error";
		error.details = body?.details ?? null;
		throw error;
	}

	return (await response.json()) as T;
}

export type CreateBookingBody = {
	resourceId: string;
	userId: string;
	day: string;
	startMinute: number;
	endMinute: number;
	title: string;
};

export const api = {
	resources: (): Promise<Resource[]> =>
		request<{ items: Resource[] }>("/api/resources").then((body) => body.items),

	schedule: (resourceId: string, day: string, viewer: string): Promise<Schedule> =>
		request<Schedule>(
			`/api/resources/${resourceId}/schedule?day=${day}&viewer=${encodeURIComponent(viewer)}`,
		),

	bookings: (day: string): Promise<Booking[]> =>
		request<{ items: Booking[] }>(`/api/bookings?day=${day}`).then((body) => body.items),

	create: (body: CreateBookingBody): Promise<Booking> =>
		request<Booking>("/api/bookings", { method: "POST", body: JSON.stringify(body) }),

	cancel: (id: string, userId: string): Promise<Booking> =>
		request<Booking>(`/api/bookings/${id}?userId=${encodeURIComponent(userId)}`, {
			method: "DELETE",
		}),
};

export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return "что-то пошло не так";
}

/** Разбор события из /api/stream: сервер шлёт JSON в поле data. */
export function parseStreamEvent(data: string): StreamEvent | null {
	try {
		const parsed = JSON.parse(data) as StreamEvent;
		return parsed.type === "booking.created" || parsed.type === "booking.cancelled" ? parsed : null;
	} catch {
		return null;
	}
}
