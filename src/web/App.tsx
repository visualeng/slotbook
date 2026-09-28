/**
 * Страница брони: состояние, загрузка и обработчики.
 *
 * Логика выбора диапазона живёт здесь, а не в компонентах сетки: компоненты
 * остаются тупыми, а правило «в диапазоне не должно быть занятых слотов»
 * легко прочитать и покрыть тестом.
 */
import { useCallback, useEffect, useState } from "react";
import type { Booking, Resource, Schedule, ScheduleSlot, StreamEvent } from "../shared/types";
import { api, describeError } from "./api";
import { MyBookings } from "./components/MyBookings";
import { ScheduleGrid } from "./components/ScheduleGrid";
import { SelectionBar } from "./components/SelectionBar";
import { useStream } from "./hooks/useStream";

const VIEWER_KEY = "slotbook.viewer";

/** Сегодня по местному времени: toISOString ушёл бы в UTC и иногда на день назад. */
function todayIso(): string {
	const now = new Date();
	return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Имя пользователя: запоминается в localStorage, чтобы брони были своими. */
function initialViewer(): string {
	const stored = window.localStorage.getItem(VIEWER_KEY);
	if (stored !== null && stored !== "") {
		return stored;
	}
	const generated = `user-${Math.random().toString(36).slice(2, 8)}`;
	window.localStorage.setItem(VIEWER_KEY, generated);
	return generated;
}

export function App() {
	const [resources, setResources] = useState<Resource[]>([]);
	const [resourceId, setResourceId] = useState("");
	const [day, setDay] = useState(todayIso());
	const [viewer, setViewer] = useState(initialViewer);

	const [schedule, setSchedule] = useState<Schedule | null>(null);
	const [myBookings, setMyBookings] = useState<Booking[]>([]);

	const [anchor, setAnchor] = useState<number | null>(null);
	const [rangeEnd, setRangeEnd] = useState<number | null>(null);
	const [title, setTitle] = useState("");

	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api
			.resources()
			.then((items) => {
				setResources(items);
				setResourceId(items[0]?.id ?? "");
			})
			.catch((cause: unknown) => setError(describeError(cause)));
	}, []);

	const refresh = useCallback(async () => {
		if (resourceId === "") {
			return;
		}
		try {
			const [nextSchedule, dayBookings] = await Promise.all([
				api.schedule(resourceId, day, viewer),
				api.bookings(day),
			]);
			setSchedule(nextSchedule);
			setMyBookings(dayBookings.filter((booking) => booking.userId === viewer));
		} catch (cause: unknown) {
			setError(describeError(cause));
		}
	}, [resourceId, day, viewer]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Чужая бронь на мой день тоже меняет сетку, поэтому на любое событие дня
	// просто перезапрашиваем расписание.
	const onStreamEvent = useCallback(
		(event: StreamEvent) => {
			if (event.booking.day === day) {
				void refresh();
			}
		},
		[day, refresh],
	);
	const { live } = useStream(onStreamEvent);

	const pick = (slot: ScheduleSlot) => {
		setError(null);
		setNotice(null);

		if (anchor === null || slot.startMinute < anchor) {
			setAnchor(slot.startMinute);
			setRangeEnd(slot.endMinute);
			return;
		}
		if (slot.startMinute === anchor) {
			setRangeEnd(slot.endMinute);
			return;
		}

		const crosses = (schedule?.slots ?? []).some(
			(candidate) =>
				candidate.startMinute >= anchor &&
				candidate.endMinute <= slot.endMinute &&
				candidate.state !== "FREE",
		);
		if (crosses) {
			setAnchor(slot.startMinute);
			setRangeEnd(slot.endMinute);
			setNotice("в диапазоне есть занятые слоты — выбор начат заново");
			return;
		}
		setRangeEnd(slot.endMinute);
	};

	const submit = async () => {
		if (resourceId === "" || anchor === null || rangeEnd === null) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const created = await api.create({
				resourceId,
				userId: viewer,
				day,
				startMinute: anchor,
				endMinute: rangeEnd,
				title: title.trim(),
			});
			setNotice(`занято: ${created.resourceName}`);
			setAnchor(null);
			setRangeEnd(null);
			setTitle("");
		} catch (cause: unknown) {
			setError(describeError(cause));
		} finally {
			setBusy(false);
			await refresh();
		}
	};

	const cancel = async (booking: Booking) => {
		setBusy(true);
		setError(null);
		try {
			await api.cancel(booking.id, viewer);
			setNotice("бронь отменена, слот снова свободен");
		} catch (cause: unknown) {
			setError(describeError(cause));
		} finally {
			setBusy(false);
			await refresh();
		}
	};

	const changeViewer = (next: string) => {
		const value = next.trim() === "" ? "guest" : next.trim();
		window.localStorage.setItem(VIEWER_KEY, value);
		setViewer(value);
	};

	return (
		<main>
			<header>
				<h1>slotbook</h1>
				<span className={live ? "badge live" : "badge"} data-testid="live">
					{live ? "live" : "offline"}
				</span>
			</header>

			<form className="controls" onSubmit={(event) => event.preventDefault()}>
				<label>
					Я
					<input
						value={viewer}
						onChange={(event) => changeViewer(event.target.value)}
						data-testid="viewer-input"
					/>
				</label>
				<label>
					День
					<input
						type="date"
						value={day}
						onChange={(event) => {
							setDay(event.target.value);
							setAnchor(null);
							setRangeEnd(null);
						}}
						data-testid="day-input"
					/>
				</label>
				<label>
					Ресурс
					<select
						value={resourceId}
						onChange={(event) => {
							setResourceId(event.target.value);
							setAnchor(null);
							setRangeEnd(null);
						}}
						data-testid="resource-select"
					>
						{resources.map((resource) => (
							<option key={resource.id} value={resource.id}>
								{resource.name}
							</option>
						))}
					</select>
				</label>
			</form>

			{error !== null ? (
				<p className="error" role="alert" data-testid="error">
					{error}
				</p>
			) : null}
			{notice !== null ? (
				<p className="notice" data-testid="notice">
					{notice}
				</p>
			) : null}

			<SelectionBar
				startMinute={anchor}
				endMinute={rangeEnd}
				title={title}
				busy={busy}
				onTitleChange={setTitle}
				onSubmit={() => {
					void submit();
				}}
				onReset={() => {
					setAnchor(null);
					setRangeEnd(null);
				}}
			/>

			{schedule !== null ? (
				<ScheduleGrid
					schedule={schedule}
					anchor={anchor}
					rangeEnd={rangeEnd}
					busy={busy}
					onPick={pick}
					onCancel={(booking) => {
						void cancel(booking);
					}}
				/>
			) : (
				<p className="muted">Загружаю расписание…</p>
			)}

			<MyBookings
				bookings={myBookings}
				busy={busy}
				onCancel={(booking) => {
					void cancel(booking);
				}}
			/>
		</main>
	);
}
