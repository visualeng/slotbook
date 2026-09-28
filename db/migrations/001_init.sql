-- slotbook: ресурсы и брони.
--
-- Ключевое решение — пересекающиеся брони физически невозможны: за это
-- отвечает exclusion-ограничение в самой базе, а не проверка в коде.
-- Проверка «а не занято ли» в приложении всегда проигрывает гонке двух
-- одновременных запросов; ограничение — нет.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS resources (
    id           UUID PRIMARY KEY,
    name         TEXT NOT NULL,
    slot_minutes INT  NOT NULL CHECK (slot_minutes BETWEEN 5 AND 240),
    open_minute  INT  NOT NULL CHECK (open_minute BETWEEN 0 AND 1439),
    close_minute INT  NOT NULL CHECK (close_minute BETWEEN 1 AND 1440),
    CHECK (open_minute < close_minute)
);

CREATE TABLE IF NOT EXISTS bookings (
    id           UUID PRIMARY KEY,
    resource_id  UUID        NOT NULL REFERENCES resources (id) ON DELETE CASCADE,
    user_id      TEXT        NOT NULL,
    day          DATE        NOT NULL,
    start_minute INT         NOT NULL CHECK (start_minute >= 0 AND start_minute < 1440),
    end_minute   INT         NOT NULL CHECK (end_minute > 0 AND end_minute <= 1440),
    title        TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- интервал приведён к tsrange: с ним exclusion-ограничение умеет
    -- сравнивать пересечения, а приложение не занимается арифметикой дат
    slot TSrange GENERATED ALWAYS AS (
              tsrange(day::timestamp + start_minute * interval '1 minute',
                      day::timestamp + end_minute * interval '1 minute')
          ) STORED,

    CHECK (start_minute < end_minute),

    -- два запроса на один и тот же слот одного ресурса не пройдут никогда
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        resource_id WITH =,
        slot        WITH &&
    ) WHERE (status = 'CONFIRMED'),

    -- и человек не может забронировать два ресурса одновременно
    CONSTRAINT bookings_user_no_overlap EXCLUDE USING gist (
        user_id WITH =,
        slot     WITH &&
    ) WHERE (status = 'CONFIRMED')
);

CREATE INDEX IF NOT EXISTS bookings_day_idx      ON bookings (day);
CREATE INDEX IF NOT EXISTS bookings_user_day_idx ON bookings (user_id, day);

-- демо-ресурсы: стенд должен открываться не пустым
INSERT INTO resources (id, name, slot_minutes, open_minute, close_minute) VALUES
    ('11111111-1111-4111-8111-111111111111', 'Переговорная «Кофе»', 30, 540, 1080),
    ('22222222-2222-4222-8222-222222222222', 'Переговорная «Чай»', 60, 600, 1200),
    ('33333333-3333-4333-8333-333333333333', 'Стол в ковординге', 30, 480, 1200)
ON CONFLICT (id) DO NOTHING;
