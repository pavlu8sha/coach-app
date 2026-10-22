# Карта веток Coach App

Этот документ содержит **только подробности о ветках**: назначение, сохранённые изменения, риски и точку возобновления. Общий статус проекта и таблица Issue → PR находятся в [PROJECT_STATUS.md](PROJECT_STATUS.md) — единственном главном статусном документе.

Сведения ниже — снимок на 21.10.2026. Перед удалением, продолжением работы или переносом изменений заново сравнить ветку с актуальным `master`.

## Активные ветки

| Ветка | PR / Issue | Назначение и сделанное | Что осталось |
|---|---|---|---|
| `master` | — | Стабильная интеграционная ветка; ruleset `Protect master` снят 2026-10-22, прямой push разрешён | Production-версию проверять отдельно |
| `stage-abc` | [PR #2](https://github.com/pavlu8sha/coach-app/pull/2), [Issue #4](https://github.com/pavlu8sha/coach-app/issues/4) | Аудит OpenCode: DRY_RUN, clubSource_, auth-примитивы, тесты | Проверить каждый server endpoint и write-path; не вливать PR целиком; принимаемые темы вынести отдельными PR |
| `chore/repository-governance` | [PR #3](https://github.com/pavlu8sha/coach-app/pull/3), [Issue #6](https://github.com/pavlu8sha/coach-app/issues/6) | Документация, шаблоны GitHub, workflow CI | Завершить review/CI; после merge проверить workflow и включить обязательный check |
| `perf-phase1` | [Issue #5](https://github.com/pavlu8sha/coach-app/issues/5) | 5 уникальных коммитов на момент проверки; инструментация и оптимизации | Не вливать целиком; проверить эквивалентность платежей/посещаемости/групп, CI и PERF_LOG=false; переносить выборочно |

## Исторические ветки-кандидаты на удаление

По предыдущему сравнению с master у перечисленных веток было `ahead_by = 0`; это снимок, а не гарантия текущего состояния. Повторно сравнить перед удалением. См. [Issue #7](https://github.com/pavlu8sha/coach-app/issues/7).

| Ветка | Было позади master |
|---|---:|
| `design-e` | 70 |
| `design-g` | 34 |
| `design-p1-noclip` | 4 |
| `design-p1` | 4 |
| `design-settings-fixes` | 29 |
| `design-targets` | 3 |
| `design-ui016` | 1 |
| `design-v1` | 78 |
| `disc-preview` | 8 |
| `disc-rule-fix` | 13 |
| `disc-rule-v2` | 11 |
| `fix-att-binding` | 97 |
| `settings-and-fixes` | 62 |
| `settings-stage2` | 51 |
| `settings-stage3` | 31 |

**Не удалять** активные ветки `stage-abc`, `perf-phase1`, `chore/repository-governance` или `master`. Старые ветки не удалены до отдельного решения владельца.

## Правила возобновления работы

- Сверить актуальные base/head SHA, открытые PR, Issues и CI.
- Не продолжать старую ветку автоматически: для новой реализации создавать свежую ветку от актуального master.
- Не cherry-pick/merge всю `perf-phase1` или `stage-abc` вслепую.
- Отдельной тестовой среды нет; `/dev` production-проекта использует боевые таблицы. Разрешены локальные моки, CI и read-only проверки; запрещены тестовые записи в production.
- После решения по ветке обновить эту карту и главный статусный документ.