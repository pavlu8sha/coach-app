# Coach App

Веб-приложение для управления футбольной школой: игроки, группы, посещаемость, абонементы и платежи, дополнительные и индивидуальные занятия, экипировка и административные операции.

## Статус проекта

**Единственный главный источник общего статуса:** [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

Подробная карта веток: [docs/BRANCH_ROADMAP.md](docs/BRANCH_ROADMAP.md). Принятые решения: [docs/DECISIONS.md](docs/DECISIONS.md). Роли агентов и передача задач: [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md). Пошаговая передача для Claude: [docs/CLAUDE_HANDOFF.md](docs/CLAUDE_HANDOFF.md).

## Источник истины и релиз

- **`master`** — основная стабильная ветка исходного кода.
- **GitHub Issues** — задачи, дефекты и решения, которые ещё нужно принять.
- **Pull Requests** — штатный путь внесения изменений в `master`.
- **Публикация** — отдельный этап. Слияние в `master` само по себе не означает выкладку в production.

## Технологии и тесты

- Новое приложение: Supabase (Postgres, RLS, Edge Functions), веб-приложение `web/` (React + Vite), Telegram-бот.
- Старое приложение (Google Apps Script) вынесено в отдельный репозиторий [pavlu8sha/coach-app-legacy](https://github.com/pavlu8sha/coach-app-legacy) и заморожено после миграции 31.10.2026.
- Автоматические Node.js-тесты находятся в `tests/`.
- Workflow `.github/workflows/test.yml` запускает `node --test tests/preflight-coverage.test.mjs tests/import/*.test.mjs tests/edge/*.test.mjs` для PR в `master` и push в `master`.

Тесты с моками и GitHub Actions не должны изменять боевые таблицы. `/dev` production-проекта использует те же таблицы, что и `/exec`; не запускайте экспериментальные операции записи через production Apps Script.

## Рабочий процесс

1. Перед началом работы обновить `master` и проверить открытые Issues/PR.
2. На одну логически связанную задачу — отдельная ветка и PR.
3. Не редактировать одну область параллельно в разных ветках без согласования.
4. PR должен описывать причину, изменения, риски, тесты и статус deployment.
5. Не вливать PR, пока проверки не пройдены и замечания не закрыты.
6. После merge отдельно указать, выложен ли код в production.
7. Не удалять старые ветки до проверки уникальных коммитов и решения владельца.

Подробные правила: [CONTRIBUTING.md](CONTRIBUTING.md).