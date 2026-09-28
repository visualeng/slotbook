/** Ошибки приложения: у каждой есть код для клиента и HTTP-статус. */
export class AppError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
		this.name = new.target.name;
	}
}

export class ValidationError extends AppError {
	constructor(code: string, message: string, details?: unknown) {
		super(400, code, message, details);
	}
}

export class NotFoundError extends AppError {
	constructor(code: string, message: string) {
		super(404, code, message);
	}
}

export class ConflictError extends AppError {
	constructor(code: string, message: string, details?: unknown) {
		super(409, code, message, details);
	}
}
