/**
 * Панель подтверждения: сначала клик по слоту, потом выбор границ и заголовка.
 *
 * Двухшаговый выбор здесь не из красоты: интервал должен быть кратен слоту и
 * лежать в рабочих часах, поэтому границы показываются до отправки запроса,
 * а не после отказа сервера.
 */
export type SelectionBarProps = {
	startMinute: number | null;
	endMinute: number | null;
	title: string;
	busy: boolean;
	onTitleChange: (title: string) => void;
	onSubmit: () => void;
	onReset: () => void;
};

function formatMinute(minute: number): string {
	const hours = Math.floor(minute / 60);
	return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function SelectionBar({
	startMinute,
	endMinute,
	title,
	busy,
	onTitleChange,
	onSubmit,
	onReset,
}: SelectionBarProps) {
	if (startMinute === null || endMinute === null) {
		return (
			<p className="selection empty" data-testid="selection-empty">
				Выберите слот в сетке — второй клик по слоту задаст конец брони.
			</p>
		);
	}

	return (
		<form
			className="selection"
			data-testid="selection"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<strong data-testid="selection-range">
				{formatMinute(startMinute)}–{formatMinute(endMinute)}
			</strong>
			<input
				type="text"
				value={title}
				maxLength={120}
				placeholder="Например, ревью архитектуры"
				onChange={(event) => onTitleChange(event.target.value)}
				data-testid="title-input"
			/>
			<button type="submit" disabled={busy} data-testid="submit-booking">
				{busy ? "Бронирую…" : "Забронировать"}
			</button>
			<button type="button" onClick={onReset} disabled={busy} data-testid="reset-selection">
				Сбросить
			</button>
		</form>
	);
}
