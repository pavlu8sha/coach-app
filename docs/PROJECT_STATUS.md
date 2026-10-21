# Coach App — главный статус проекта

Последнее обновление: 2026-10-21. **Это единственный главный документ общего статуса.** Перед действиями сверять фактические SHA, PR и CI в GitHub.

Подробная карта веток: [BRANCH_ROADMAP.md](BRANCH_ROADMAP.md). Правила работы: [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md), [CONTRIBUTING.md](../CONTRIBUTING.md).

## Зафиксированное состояние

- `master` после merge PR #3: `b6c7ff04f726a5995a889b1e6deb1a61f605d5e0` (сверять актуальный HEAD перед работой).
- Ruleset `Protect master` активен: PR обязателен, force-push и удаление master запрещены, bypass list пустой.
- Workflow `Тесты` теперь находится в master; [последний run на HEAD PR #3](https://github.com/pavlu8sha/coach-app/actions/runs/39590822753) завершился успешно.
- **Обязательный CI check пока не включён.** Следующий шаг — проверить запуск после merge и включить required status check в ruleset.
- Слияние в GitHub не означает публикацию в Apps Script. Production deployment отдельно не подтверждён.
- Тестовая среда отсутствует; `/dev` production-проекта использует боевые таблицы. Никаких тестовых записей в production.

## Матрица Issue → ветка → PR → статус → следующий шаг

| Issue | Ветка | PR | Статус | Следующий шаг |
|---|---|---|---|---|
| [#1 — эпик](https://github.com/pavlu8sha/coach-app/issues/1) | — | — | В работе | Закрыть чеклист после завершения подзадач |
| [#4 — аудит безопасности](https://github.com/pavlu8sha/coach-app/issues/4) | `stage-abc` | [#2](https://github.com/pavlu8sha/coach-app/pull/2) | Draft, аудит; не сливать целиком | Проверить endpoints/roles, DRY_RUN, источники данных; принятые темы вынести в отдельные PR |
| [#5 — производительность](https://github.com/pavlu8sha/coach-app/issues/5) | `perf-phase1` | — | На независимом ревью | Проверить эквивалентность, CI и PERF_LOG=false; переносить только подтверждённые изменения |
| [#6 — защита master и CI](https://github.com/pavlu8sha/coach-app/issues/6) | `docs/status-after-pr3` | [#3](https://github.com/pavlu8sha/coach-app/pull/3) (merged) | Workflow в master; required check ещё не включён | Проверить run после merge и включить обязательный check |
| [#7 — старые ветки](https://github.com/pavlu8sha/coach-app/issues/7) | 15 исторических веток | — | Сравнены; не удалены | Повторно сравнить с master и удалить только после подтверждения владельца |

## Текущие PR и ограничения

- **PR #2 — OpenCode / `stage-abc`:** сборный аудит нескольких тем, намеренно не готов к merge. Дублирующий workflow удалён отдельным коммитом. После появления workflow в master отдельный CI run на актуальном HEAD PR #2 ещё не подтверждён; ждать следующего обновления ветки и проверить Actions. Не выполнять deployment и не писать в production.
- **PR #3 — документация и CI:** [слит в master](https://github.com/pavlu8sha/coach-app/pull/3). README, CONTRIBUTING, `docs/`, шаблоны GitHub и workflow теперь доступны в основной ветке.
- Workflow должен находиться ровно в одном месте: `.github/workflows/test.yml` в master. В PR #2 файл удалён.
- 15 исторических веток не удалены, список — в BRANCH_ROADMAP.md.

## Роли и рабочий порядок

- Владелец продукта принимает решения о merge, удалении веток и deployment.
- OpenCode завершает только назначенный аудит в `stage-abc`; не редактировать эту ветку параллельно.
- ChatGPT координирует статус, документацию и независимое ревью; без deployment без отдельного решения.
- Claude начинает независимую задачу только после handoff и сверки актуального GitHub.
- Один активный исполнитель на одну область кода. Успешный CI не заменяет code review.

## Что означает завершение

1. Работа готова в ветке — исполнитель отчитался, тесты и риски указаны.
2. Изменение принято — PR прошёл review/CI и влит в master.
3. Приложение опубликовано — отдельный deployment выполнен и подтверждён конкретной версией/SHA.

Не смешивать эти статусы. Обновлять этот документ при каждом существенном изменении состояния.