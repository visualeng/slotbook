/** Шина событий: брони и отмены уезжают всем подписчикам /api/stream. */
import type { StreamEvent } from "../shared/types";

type Listener = (event: StreamEvent) => void;

export type EventBus = {
	publish: (event: StreamEvent) => void;
	subscribe: (listener: Listener) => () => void;
	listenerCount: () => number;
};

export function createEventBus(): EventBus {
	const listeners = new Set<Listener>();

	return {
		publish(event) {
			for (const listener of listeners) {
				// один кривой подписчик (например, уже отвалившийся поток) не должен
				// ронять остальных
				try {
					listener(event);
				} catch {
					listeners.delete(listener);
				}
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		listenerCount: () => listeners.size,
	};
}
