# Карта веток Coach App

Этот документ содержит **только подробности о ветках**. Общий статус проекта и таблица Issue → PR — в [PROJECT_STATUS.md](PROJECT_STATUS.md).

Снимок на 22.10.2026 (после очистки, [Issue #7](https://github.com/pavlu8sha/coach-app/issues/7)).

## Ветки на GitHub

| Ветка | PR | Назначение |
|---|---|---|
| `master` | — | Стабильная интеграционная ветка; прямой push разрешён (решение владельца 2026-10-22). Из неё и только из неё делается `clasp push` |
| `fix/rev-month-dup` | [PR #27](https://github.com/pavlu8sha/coach-app/pull/27) | Убрать вторую `revMonth_` (из аудита `stage-abc`) |

## Очистка 22.10.2026

Удалены все остальные ветки (≈47). Перед удалением каждая сверена с master:

- **без коммитов вне master** — ветки слитых PR (#9, #10, #12, #13, #15–#17, #19–#24), ветки дизайна, настроек, скидок и т. п.: всё содержимое в master;
- **с коммитами вне master** — содержимое уже в master в другом виде или решено не переносить; коммиты остаются доступны в закрытых PR:

| Ветка | Где коммиты | Итог |
|---|---|---|
| `stage-abc` | `refs/pull/2/head` | PR #2 закрыт; решения по темам — [Issue #4](https://github.com/pavlu8sha/coach-app/issues/4) |
| `chore/repository-governance` | `refs/pull/3/head` | слит как #3 (squash) |
| `docs/status-after-pr3` | `refs/pull/8/head` | слит как #8 |
| `refactor/club-sources` | `refs/pull/11/head` | заменён #12 |
| `fix/private-maintenance-functions` | `refs/pull/14/head` | заменён #15 |
| `perf-phase1` | — (PR не было) | рабочий код перенесён в #19–#21, #25, #26; не перенесены только точки подробных замеров — не нужны, при необходимости добавить заново в текущий код |

Посмотреть коммиты закрытого PR: `git fetch origin pull/<номер>/head:pr-<номер>`.

## Правила

- Новая работа — свежая ветка от актуального master; после слияния PR ветку удалить.
- Старые ветки не продолжать: начинать заново от master.
- Отдельной тестовой среды нет: `/dev` использует боевые таблицы. Локально — моки и CI; тестовые записи в production запрещены.
- Перед `clasp push`: `git branch --show-current` = `master`.

## Удалённые ветки, слитые через PR (2026-10-26)

47 веток, PR которых слит (номер PR есть в истории `master`), удалены. Удалены владельцем 2026-10-26 (из сессии Claude удаление веток запрещено, 403). Коммиты остаются в GitHub в `refs/pull/<N>/head`. После удаления восстановить ветку: `git push origin <SHA>:refs/heads/<имя>`.

| Ветка | PR | SHA |
|---|---|---|
| data/quality-report | #124 | 8d1981f1cbe569985f2dd0fda62f495b312061a2 |
| docs/cutover-trainers | #203 | d6b5170d133408a2367d0060664f859d80b4102a |
| docs/feature-parity | #117 | f13407cafd5d03722f279e5f53b260e72c5a50ac |
| docs/final-import | #205 | 0d9f9b0e2ec6a6c34186a3c897a240f908693c9d |
| docs/monday-migrations | #141 | c680940b7d68ea0f0f3eb9f016eac35a78c1ce36 |
| docs/owner-questions | #123 | 32a41d5e1f55dbd4ca7d23194c2bae0872c41761 |
| docs/runbook | #115 | 3c8a50fcaafa03544d10b0798295f00a2298a53d |
| docs/staff-launch | #137 | 8d15090dedc8d034fd9280aa47f42bb794c6f22a |
| docs/sync-plan | #135 | 3e331480fe86f783be813f56832ca70be2ba37ca |
| docs/trainer-guide | #202 | ae3a62dd5404580c76ea700ff109442f426f48ba |
| feat/attendance-stats | #126 | 5d11ed69adfd0d254767f2af4b532b8926b647b7 |
| feat/bot-leads | #134 | 6d3c44955e2e0a7481b98b4571e7cd0a60c08973 |
| feat/camps-admin | #132 | b20ff9b739afa32a8ea618ed966e10040de629bf |
| feat/cash-by-date | #191 | 72ecd5cb05742620e8015a47beda7b2edce909d8 |
| feat/cash-desk | #189 | 6cec9e52eea690cbabfa65f3d7237c3c13060ee7 |
| feat/coach-extra-attendance | #200 | 9eed2ae5218bd1d996ef619791d973af240c4673 |
| feat/coach-special-attendance | #199 | ec7296fe321151e5ad2d5f6fe77951d1a8e03ec3 |
| feat/debtors-pay-copy | #195 | b3a518c54797b8a048e51219c6dd86a5d903bd93 |
| feat/edge-deno-tests | #120 | d72d0d3fd8bb263fb8e1f8181836cae171a6596c |
| feat/equipment-admin | #130 | 1b73ff0c89ec796805f9da1b388f02192cfc247a |
| feat/event-fees-bulk | #197 | 2ef92e99d64cd4bed76b1246c13114b811d796a0 |
| feat/extra-sessions | #129 | 0f2448b8704989b9135ab2949e8554b4047780f5 |
| feat/ind-change-type | #183 | 8bba08974986c63c3569332b37d0ddd80b9e4aad |
| feat/individual-sessions | #128 | c6ebe7fdebea4af8944f8779a041ffaf5c3f85c1 |
| feat/month-payments | #136 | fd4b5c1526b160e71b5335d561ab2a21478ae308 |
| feat/notifications-v2 | #122 | 5d25908798399a9045cbb36e116f53fe509a85f3 |
| feat/player-card-tabs | #192 | 31acfc71807714e22f34cd257388233b9135ed64 |
| feat/player-duplicate-check | #127 | 26f2f28b1bbc7b5be59e5b3e67c9810004428609 |
| feat/points-start | #138 | 57494bbaf9278ebe5a6d7826014e92ce7316b41e |
| feat/responsive-layout | #186 | 2477346840d23321d0921402d4e5c8824ec8d213 |
| feat/subscriptions-admin | #125 | f5c24ebdf715f9c6145baf017acfd71fe050ce9e |
| feat/training-log-admin | #133 | 2fe7c27456ad450cdb4327fb4ef17698a32fbca1 |
| feature/bulk-match-fee | #153 | b1c2eb49ddc385bcb1627007bc88983c0536b8bc |
| feature/equip-issue-filter | #158 | 3d09834861248b93a9dc3d442327a9a051a3c974 |
| feature/trainer-accounting-view | #178 | 326768871e20ff3a2d01ff79282e346dd79d980a |
| fix/bulk-checkbox | #169 | 0a3647f320b0116a4e6dda29176c8bf2747698cd |
| fix/camp-dates-timezone | #155 | 518891570e3b4fe26e88259af3218e148c82bb64 |
| fix/child-code-hardening | #114 | 4901a67b54058cc0d3c97e46b7c622edd42d496e |
| fix/date-input-width | #154 | 48b35c071ba6597501a8bf62178f76e168f0532c |
| fix/import-ind-goalkeepers | #204 | d2381eca872a25c8b58a0415f53fd4e4f58007c7 |
| fix/ind-goalkeepers-backfill | #177 | 67dda34d764d12694cc9a6239b13f601d65778f1 |
| fix/match-team-group-suffix | #173 | 269d8b2e0b3068cbbae5351f3b20e3998a88d4c4 |
| fix/rename-u12-team | #174 | eb4f771e48dcfda8fc9b84cc8d1c1ac20543d387 |
| fix/staff-layout | #145 | 930694f0f79ee206e4873085476bfa8b02cd95f9 |
| fix/trainer-tabs-overflow | #184 | f3ba8ff0fff031255e0606d6c2cd8c3e3f9d3a32 |
| test/ui-admin-modules | #142 | 9490bc62a4e7181c6bd8acc870ec639b5b92c601 |
| test/ui-vitest | #116 | d7cfa058d113d76416c31c7bb1dc25ff6191ef99 |

## Ветки, содержимое которых уже в master: к удалению (2026-10-26)

55 веток, добавленные строки которых на ≥95% уже есть в `master`; у всех есть PR, коммиты остаются в `refs/pull/<N>/head`. Удаляет владелец (из сессии Claude удаление запрещено, 403); после удаления отметить здесь дату. Восстановить ветку: `git push origin <SHA>:refs/heads/<имя>`.

| Ветка | PR | SHA |
|---|---|---|
| ci/pgtap | #70 | 8d6ae2a66b058e74e4a09f0f9d118c22d4059c73 |
| design/parent-ui-v1 | #84 | 9f64b3db92fda1611902938cc58afe6d6a35699f |
| docs/deploy-30c96a8 | #29 | 490cce6d25f54f8f50e644d0784a7e68ae7a2e58 |
| docs/equipment-status | #131 | 08f2c578b9b772a30dae98bb876e081034f89766 |
| docs/handoff-2026-10-23 | #86 | 64fb842c279836db72662ce2f7e4ff7a5537c30c |
| docs/launch-audit | #60 | be0575a241d584e3270693a6863b07013b8179d0 |
| docs/parent-ui-design-v1 | #83 | 430786f716e718157065dde126820d683842a865 |
| docs/platform-funnel-note | #39 | ded256ef45f173a46155eee0a85d03895f71642f |
| docs/platform-plan | #33 | 8e166b56c3280f554569f945816bf5907f8ab16a |
| docs/status-2026-10-22 | #28 | e643156b73e7c20a2d514d3e0991029c9e302f40 |
| docs/status-parent-ui-v1 | #85 | 380dd804e70bc6c061516beb5bc69b0ff0cfa8e4 |
| feat/admin-payments-prices | #105 | 4f545fe5dd673853cae85fcaf6ef775c9abb9385 |
| feat/auth-rate-limit | #77 | 398e0e34acc25d05358931e423d0d3137084e526 |
| feat/birth-dates | #64 | 0273a694abc2c8494b449ce6bb0eb0e19c12d028 |
| feat/bot-notifications | #101 | 5d212d3544f3c2c09420286d46a9dc490e6a7343 |
| feat/browser-login | #99 | 02f495bd3e06ebfd77cf43156357fbe0cfaf07b2 |
| feat/camps-settings-verify | #111 | 40b1aec08260ad8c4f1b0849a41487d33c7261ff |
| feat/coach-points-contacts | #91 | 74bae430fee783b382dda8a3f4711da95af1d084 |
| feat/consent-coach-contacts | #92 | 52cfb51ed72baa97263840adf8fb603f10e43a6e |
| feat/consent-controls | #100 | e58ac73a01584592fd0eec5339eb2483a506cd86 |
| feat/equip-issue | #62 | 72eb5debedeb59ec6d27dcc3b8ce09ec2b9e74d1 |
| feat/goals-import | #55 | 84b45ed851b5f5efed2682775ed4baf1cf4a52de |
| feat/import-equipment | #51 | 5ed51ea5914bb13b6dbd1b5c07a981b7a94c159d |
| feat/import-events | #52 | f79591098bda56b432adca50d9a945ba5f62ba6e |
| feat/import-gsheets | #44 | 30750783c6cc8b2b374a80cdf2bb4a911b76d34a |
| feat/import-players | #43 | 4901a42e008673b3fa731e5948180abdef9f4db7 |
| feat/link-cancel-retry | #88 | b004fee5cb910020c386019e68379f81e9ff4df0 |
| feat/migration-export | #45 | f6ad94c2b4b59283c96225c8be4a21cf801a62db |
| feat/parent-matches | #98 | 11d9b2a6ac669ce4c2df04d419b081c40f90b00c |
| feat/parent-profile | #87 | ec6b7a5923cdb7ee1d7f0cba63d50d0ee8d76a65 |
| feat/payments-sync-app | #31 | f643ef5404fd36177360405722ccdd7e49cd9400 |
| feat/prices-debt | #96 | 750f8704ace3bc030ac35163e8ef0ef9414d0631 |
| feat/rating-rules | #65 | aa0afb33e4424fff0d67571255a57d099ec28f3a |
| feat/rls-legacy | #40 | 654f249192487579509529fa7fef750d5fe11f7a |
| feat/rls-policies | #36 | e0bdb574e2b05515b1f906facc918b05559a09b0 |
| feat/schedule | #78 | 434516f64646b5dc7237552a4443c8988fdc65b8 |
| feat/schedule-log | #59 | 53f4a5904ca2bf2a866ec550791d8e4d24c7e4fb |
| feat/schema-legacy-domains | #38 | 42b1c96f6c62a945c778fb0c3cf58b77e5550d54 |
| feat/tech-design | #35 | 960bbf808ac408539923a45929979c7be5c9c450 |
| feat/tg-auth | #66 | 85657c488eddc8aa2478d97db776d437cc137cd0 |
| feat/verify | #103 | 8d2e19284cc861cf1b78ff409f51944d97e5bc5f |
| fix/admin-embed | #72 | 8566f5275c73f32c674d85377d1ff220d0120444 |
| fix/attendance-dates | #63 | c2a39c907e54150b74aad79dfa71f63ced0bb768 |
| fix/claspignore | #74 | 764b2bab85598add41279b61d9c84255dca3df8b |
| fix/equip-new-rows-clear | #53 | e30663c181322acbc8e19caa561b444aefcc418b |
| fix/export-gn-file | #46 | b78ecfb98d72d0b047cc6094e73b83e38b33aa3c |
| fix/groups-guardian-read | #69 | e3e69e28912f7e1ad13a8992959f7a28d9303211 |
| fix/horizontal-scroll | #110 | 31712513df951a3e923129a889b069e083c3557a |
| fix/import-empty-response | #48 | 31e1f0057ea17f45b58b8aca2de5a9a1e3c444d7 |
| fix/legacy-test-pgtap | #41 | fdb4b83bd008c3f44f23858ae4c9427ea5a632a7 |
| fix/legacy-test-search-path | #42 | 1512ee5aa2447438b8fd1ce66d94b27cbfc7aff4 |
| fix/own-links-only | #73 | de26c0b7fb3b6fabd8c7bfe904b3289f8e4b2f30 |
| fix/rls-grants | #37 | 2c667350d4f4445ab72852f08211377b82470657 |
| fix/sync-month-options | #32 | 64c76e73e61906a13fd8973224854c4e14a765e2 |
| prep/miniapp-ui | #80 | 888788270443b4b88a4824c8fe56dcf85e672414 |
