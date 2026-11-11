-- pgTAP: тема автосозданных индивидуальных идёт по кругу со сдвигом (0177). Условия: docs/acceptance/ind-autocreate-topic-offset-2026-11-11.md
begin;
create extension if not exists pgtap;
select plan(10);

insert into clubs (id, name) values ('00000000-0000-0000-0000-00000000c001', 'Клуб');
insert into individual_templates (id, club_id, isodow, start_time, goalkeepers, topics) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c001', 6, '19:00', false,
    array['1 в 1 в ситуации соперник спереди', '1 в 1 в ситуации соперник сбоку', '1 в 1 в ситуации соперник сзади', 'Приём мяча и удары по воротам']),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000c001', 7, '18:00', false,
    array['1 в 1 в ситуации соперник спереди', '1 в 1 в ситуации соперник сбоку', '1 в 1 в ситуации соперник сзади', 'Приём мяча и удары по воротам']),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000c001', 7, '19:00', true, array['Вратари']),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000c001', 3, '17:00', false, '{}');

select ind_autocreate('2026-11-03'); -- 07-08.11
select ind_autocreate('2026-11-10'); -- 14-15.11
select ind_autocreate('2026-11-17'); -- 21-22.11
select ind_autocreate('2026-11-24'); -- 28-29.11
select ind_autocreate('2026-12-01'); -- 05-06.12
select ind_autocreate('2026-12-08'); -- 12-13.12

select is((select topic from individual_sessions where external_id = 'IND-2026-11-14-1900'), 'Приём мяча и удары по воротам', 'сб 14.11: приём мяча и удары');
select is((select topic from individual_sessions where external_id = 'IND-2026-11-15-1800'), 'Приём мяча и удары по воротам', 'вс 15.11: приём мяча и удары');
select is((select topic from individual_sessions where external_id = 'IND-2026-11-21-1900'), '1 в 1 в ситуации соперник спереди', '21.11: соперник спереди');
select is((select topic from individual_sessions where external_id = 'IND-2026-11-29-1800'), '1 в 1 в ситуации соперник сбоку', '29.11: соперник сбоку');
select is((select topic from individual_sessions where external_id = 'IND-2026-12-05-1900'), '1 в 1 в ситуации соперник сзади', '05.12: соперник сзади');
select is((select topic from individual_sessions where external_id = 'IND-2026-12-13-1800'), 'Приём мяча и удары по воротам', '13.12: круг замкнулся');
select is((select topic from individual_sessions where external_id = 'IND-2026-11-07-1900'), '1 в 1 в ситуации соперник сзади', '07.11 по тому же правилу: соперник сзади');
select is((select count(*)::int from individual_sessions where goalkeepers and topic is distinct from 'Вратари'), 0, 'вратарская: тема «Вратари» всегда');
select is((select count(*)::int from individual_sessions where topic is null and not goalkeepers and extract(isodow from starts_at) in (6, 7)), 0, 'у шаблонов с темами тема всегда есть');
select ok((select count(*) > 0 and bool_and(topic is null) from individual_sessions where extract(isodow from starts_at) = 3), 'шаблон без тем: занятия без темы, как раньше');

select * from finish();
rollback;
