# Условия приёмки: серверный список детей `my_children()` (миграция 0215)

План: `server-children-list-plan.md` (согласован Павлом 2026-11-20: делать до включения `consent.mode = all`, два PR).
Этот PR: только миграция, тест, preflight, откат. Клиент переводится отдельным PR после применения 0215.

## Зачем

Клиент сам собирает список детей по `player_guardians … consent_revoked_at is null`, а сервер решает доступ через `parent_access_ok()` (0173).
В режиме `consent.mode = all` (и `test`) условия расходятся. Нужен один серверный источник списка, согласованный с RLS.

## Модель

`my_children()` возвращает `(player_id uuid, full_name text, group_id uuid, group_name text)`:
- по одной строке на связь `player_guardians` вызывающего (`user_id = current_user_id()`), где `parent_access_ok(user_id, player_id)` истинно;
- порядок: `full_name`, затем `player_id` (стабильный);
- `group_id`, `group_name` пусты (`null`), если у игрока нет группы;
- без фильтра по `status` (как на клиенте сегодня; «Занимается» проверяет `booking_signup`);
- `security definer`, `stable`, `set search_path = public`; только чтение, ничего не меняет;
- без пользователя (`current_user_id() is null`) — `forbidden` (42501), как у `booking_board`;
- права: `revoke execute … from public, anon`, `grant execute … to authenticated`;
- `parent_access_ok`, `is_guardian_of`, RLS и таблицы не затрагиваются; существующие функции не пересоздаются.

## Условия

1. **Свои дети.** Родитель получает ровно своих детей, где `parent_access_ok` истинно; с именем, группой и названием группы.
2. **Чужие и без связи.** Дети без связи с вызывающим, дети других родителей в список не попадают. Пользователь без детей получает пустой список (не ошибку).
3. **Отзыв.** Не попадают дети с отзывом по старой модели (`consent_revoked_at`) в режиме off, с новым отзывом родителем в режиме off (не системой), с отсутствующим/устаревшим/отозванным `data_processing` в режимах test и all.
4. **Режим off.** Связь с `consent_revoked_at is null` и без нового отзыва — ребёнок в списке; системный отзыв (пересоздание связи) доступ не закрывает.
5. **Режим test.** Родитель из `consent_test_parents` — по новой модели; родитель вне списка — по прежним правилам.
6. **Режим all.** Ребёнок в списке только при действующем `data_processing` текущей версии; `consent_revoked_at` не участвует (ребёнок со старым отзывом и новым принятием виден; ребёнок с `consent_revoked_at is null`, но без принятия, не виден).
7. **Эквивалентность с RLS.** Для каждого пользователя фикстур во всех трёх режимах множество `player_id` из `my_children()` равно множеству `player_id` связей пользователя, для которых `is_guardian_of()` истинно (и совпадает с видимыми ему строками `players` среди его связей).
8. **Два родителя одного ребёнка.** Каждый видит ребёнка независимо от согласия другого; один родитель с двумя детьми получает обе строки.
9. **Без группы.** Ребёнок без группы возвращается со `group_id`/`group_name` = `null`.
10. **Права** (на базе с привилегиями по умолчанию Supabase: `alter default privileges … grant execute on functions to anon, authenticated, service_role`): `anon` вызвать не может, у `authenticated` EXECUTE есть, без пользователя в JWT — `forbidden` 42501.
11. **Только чтение.** Вызов не меняет таблицы (`player_guardians`, `players`, согласия).
12. **Preflight.** Новая строка `0215_my_children` через `to_regprocedure` (без `::regclass`); на полной базе APPLIED; в `scripts/run-db-tests.sh` шаг `preflight_partial "без 0215"` на базе без миграции: preflight не падает, строка NOT_APPLIED.
13. **Откат.** `db/ops/rollback-0215-my-children.sql`: `drop function if exists my_children()`; клиент к этому моменту возвращён на `player_guardians`.
14. **Проверки.** Полный `scripts/run-db-tests.sh` с полным выводом; перед слиянием ветка обновляется от master и CI перепроверяется. Тест-страж 0173/0176 не затрагивается.

Независимой проверки второй моделью не было (решение владельца 2026-11-11).
