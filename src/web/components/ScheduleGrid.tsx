/**
 * Сетка слотов на день: занятость с точки зрения текущего пользователя.
 *
 * Компонент ничего не знает про API — он рисует то, что прислал сервер, и
 * сообщает о кликах. Слоты приходят уже посчитанными (см. buildSlots),
 * поэтому здесь нет арифметики времени.
 */
import type { Booking, Schedule, ScheduleSlot } from "../../shared/types";

export type ScheduleGridProps = {
	schedule: Schedule;
	/** Начало выбранного диапазона в минутах от полуночи, null — ничего не выбрано. */
	anchor: number | null;
	/** Конец выбранного диапазона, null — выбран только один слот. */
	rangeEnd: number | null;
	busy: boolean;
	onPick: (slot: ScheduleSlot) => void;
	onCancel: (booking: Booking) => void;
};

function formatMinute(minute: number): string {
	const hours = Math.floor(minute / 60);
	return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function isInRange(slot: ScheduleSlot, anchor: number | null, end: number | null): boolean {
	if (anchor === null) {
		return false;
	}
	const finish = end ?? anchor + 1;
	return slot.startMinute >= anchor && slot.endMinute <= finish;
}

const STATE_LABEL: Record<ScheduleSlot["state"], string> = {
	FREE: "свободно",
	BOOKED: "занято",
	MINE: "моё",
};

export function ScheduleGrid({
	schedule,
	anchor,
	rangeEnd,
	busy,
	onPick,
	onCancel,
}: ScheduleGridProps) {
	const { resource, slots } = schedule;

	return (
		<section className="grid" aria-label={`Слоты: ${resource.name}`}>
			<table>
				<thead>
					<tr>
						<th scope="col">Время</th>
						<th scope="col">Слот</th>
						<th scope="col">Кто занял</th>
					</tr>
				</thead>
				<tbody>
					{slots.map((slot) => {
						const selected = isInRange(slot, anchor, rangeEnd);
						return (
							<tr
								key={slot.startMinute}
								data-state={slot.state}
								className={selected ? "selected" : ""}
							>
								<td className="time">
									{formatMinute(slot.startMinute)}–{formatMinute(slot.endMinute)}
								</td>
								<td>
									<button
										type="button"
										data-testid="slot"
										data-state={slot.state}
										disabled={busy || slot.state !== "FREE"}
										onClick={() => onPick(slot)}
									>
										{STATE_LABEL[slot.state]}
									</button>
								</td>
								<td className="who">
									{slot.booking ? (
										<>
											<span>{slot.booking.userId}</span>
											{slot.booking.title ? <em>{slot.booking.title}</em> : null}
											{slot.state === "MINE" ? (
												<button
													type="button"
													data-testid="cancel-booking"
													disabled={busy}
													onClick={() => onCancel(slot.booking as Booking)}
												>
													отменить
												</button>
											) : null}
										</>
									) : (
										<span className="muted">—</span>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</section>
	);
}
