/** Мои брони на выбранный день — их удобно отменять отсюда, а не из сетки. */
import type { Booking } from "../../shared/types";

export type MyBookingsProps = {
	bookings: Booking[];
	busy: boolean;
	onCancel: (booking: Booking) => void;
};

function formatMinute(minute: number): string {
	const hours = Math.floor(minute / 60);
	return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function MyBookings({ bookings, busy, onCancel }: MyBookingsProps) {
	if (bookings.length === 0) {
		return (
			<section className="mine">
				<h2>Мои брони</h2>
				<p className="muted" data-testid="mine-empty">
					На этот день пока ничего нет.
				</p>
			</section>
		);
	}

	return (
		<section className="mine">
			<h2>Мои брони</h2>
			<ul data-testid="mine-list">
				{bookings.map((booking) => (
					<li key={booking.id} data-testid="mine-item">
						<span>
							{formatMinute(booking.startMinute)}–{formatMinute(booking.endMinute)} ·{" "}
							{booking.resourceName}
							{booking.title ? ` · ${booking.title}` : ""}
						</span>
						<button
							type="button"
							disabled={busy}
							onClick={() => onCancel(booking)}
							data-testid="mine-cancel"
						>
							отменить
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
