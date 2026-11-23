# #714: lease-aware finish и продление закрепления: условия приёмки

Источник: Issue #714. Реализация в `db/migrations/0220_notifications_finish_lease.sql` и
`supabase/functions/tg-notify/index.ts`.

## Условия
- **F1.** `finish_notification(i, ok, err, give_up, token)` завершает только `pending`-строку, закреплённую этим `claim_token`.
  Старый worker с истёкшим токеном получает `false` и не меняет строку, уже выданную другому worker.
- **F2.** `release_notifications` сохраняет проверку токена (0184); stale release не снимает чужую выдачу.
- **F3.** `renew_notifications(i, token)` продлевает закрепление только своей `pending`-строки. Продление перед отправкой не даёт
  другому worker забрать строку, пока идёт запрос к Telegram; после выдачи B старый токен A продление не получает.
- **F4.** `tg-notify` продлевает закрепление перед каждым запросом, ограничивает запрос 15 секундами, пачку — 90 секундами;
  строку без токена пропускает. При ошибке `renew` или исчерпании бюджета возвращает необработанные строки без отправки.
- **F5.** Ответ 429 по-прежнему закрывает текущую строку и возвращает остальные; consent-check, stalled и лимит трёх попыток не меняются.
- **F6.** Остаточный риск at-least-once описан: если Telegram принял сообщение, а ответ/finish потерян, возможен повтор после
  истечения закрепления; бесконечного повтора нет. Миграция 0220 и новый `tg-notify` разворачиваются вместе в окно без cron.

## Проверки
- `db/tests/rls_notifications_finish_lease_test.sql` — stale finish/release, reclaim, renew, права и отсутствие старой сигнатуры.
- `db/tests/rls_notifications_queue_test.sql` — обновлённые Q1–Q9 и токены finish.
- `db/tests/concurrency_notifications_release.sh` — Q10 stale finish и Q11 renew после истечения закрепления.
- `db/ops/preflight.sql` и `scripts/run-db-tests.sh` — строка 0220, полная база APPLIED и база без 0220 NOT_APPLIED без падения preflight.
- `tests/deno/tg-notify.test.ts` — renew перед отправкой, timeout, бюджет, потеря lease, ошибка renew, finish с токеном.

## Не входит
Применение SQL на production, ACL, backfill, деплой, cron и реальные Telegram-отправки.
