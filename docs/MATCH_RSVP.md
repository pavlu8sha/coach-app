# Подтверждение участия в матчах (RSVP), Issue #274, этап 1

Миграция `0134_match_rsvp_base.sql`. PR 1 содержит только базу данных и серверные проверки. Интерфейс, уведомления и cron — PR 2.

## Состояния матча (`matches.lifecycle_status`)

```
legacy            старые матчи; приглашений нет, остаётся legacy навсегда
draft ──publish──> published ──cancel──> cancelled (необратимо)
  └─ delete_draft (окончательно)     └─ reschedule (остаётся published, ответы сбрасываются)
```

Переходы защищены триггером: другие переходы и удаление опубликованного/отменённого матча невозможны даже прямой записью.

## Таблицы

| Таблица | Назначение |
|---|---|
| `matches` (+ колонки) | `lifecycle_status`, `starts_at` (timestamptz), `venue`, `address`, `notes`, `rsvp_deadline_at` (вычисляемый: начало − 24 ч по Asia/Tbilisi), метки публикации/отмены/переносов |
| `match_invitations` | одно приглашение на пару (матч, игрок): `status` invited/removed, `response` yes/no/null («Не ответил»), `responded_by`, `answer_until` |
| `match_activity` | журнал: created, published, details_changed, rescheduled, cancelled, players_invited, players_removed, coach_response, manual_reminder |
| `match_reminder_log` | основа единого лимита напоминаний 24 ч (ручные и автоматические вместе) |

Фактическое участие (`match_players`), взносы (`match_fees`) и баллы не затрагиваются.

## Окно ответа родителя

`answer_until` = дедлайн (начало − 24 ч), а если дедлайн уже прошёл к моменту публикации/добавления игрока/пересчёта — начало матча.
Родитель отвечает только пока матч опубликован, `now < starts_at` и `now <= answer_until`. Тренер может ставить ответ до начала матча (после дедлайна — с отметкой в журнале).

## Функции (все `security definer`, доступ проверяется внутри)

Тренер клуба / администратор: `match_rsvp_create_draft`, `match_rsvp_update`, `match_rsvp_seed`, `match_rsvp_invite`, `match_rsvp_remove`, `match_rsvp_publish`, `match_rsvp_delete_draft`, `match_rsvp_cancel`, `match_rsvp_reschedule`, `match_rsvp_coach_set`, `match_rsvp_remind_unanswered`, `match_rsvp_summary`, `match_rsvp_roster`.
Родитель: `match_rsvp_answer`, `match_rsvp_answer_many`, `match_rsvp_my_matches`.
Служебные (клиентам закрыты): `rsvp_assert_staff`, `rsvp_lock_match`, `rsvp_log`, `rsvp_claim_reminder` (последняя — только `service_role`, для cron в PR 2).

## Конкурентность

Порядок блокировок везде один: сначала строка матча, потом приглашения по `player_id`. Staff-операции берут матч `FOR UPDATE`, ответы родителей — `FOR SHARE` (ответы не мешают друг другу, но ждут перенос/отмену). Проверки времени идут по `clock_timestamp()`, а не по началу транзакции. Проверка: `db/tests/concurrency_match_rsvp.sh` (параллельные сессии).

## Перенос и фактические отметки (миграция 0136)

Если у переносимого матча есть отметки или счёт, `match_rsvp_reschedule` сначала сохраняет снимок в `match_mark_snapshots` (строки `match_players` целиком, счёт, технический результат, старая дата), затем обнуляет `played`, `goals`, `best` и счёт. Строки не удаляются; баллы за матч пересчитывают существующие триггеры 0122 (прежние начисления остаются в журнале закрытыми строками). `match_rsvp_restore_marks(snapshot)` возвращает отметки и счёт, пока на матче нет новых.
