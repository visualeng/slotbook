/**
 * Подписка на /api/stream.
 *
 * События не тащат за собой весь сетка-стейт: компонент просто получает сигнал
 * и решает, что перезапросить. Так обновления от чужих брони и от своих
 * проходят по одному пути.
 */
import { useEffect, useRef, useState } from "react";
import type { StreamEvent } from "../../shared/types";
import { parseStreamEvent } from "../api";

export function useStream(onEvent: (event: StreamEvent) => void): { live: boolean } {
	const [live, setLive] = useState(false);
	// обработчик кладут в ref, чтобы переподписка не случалась на каждый рендер
	const latest = useRef(onEvent);
	useEffect(() => {
		latest.current = onEvent;
	});

	useEffect(() => {
		const source = new EventSource("/api/stream");

		source.onmessage = (message) => {
			const event = parseStreamEvent(message.data);
			if (event) {
				latest.current(event);
			}
		};
		source.onopen = () => setLive(true);
		source.onerror = () => setLive(false);

		return () => {
			source.close();
		};
	}, []);

	return { live };
}
