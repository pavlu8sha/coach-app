-- 0092: автосоздание индивидуальных (0090) — окно запуска. Если нажать «Создать занятия на выходные сейчас» в воскресенье,
-- создавалось воскресенье сегодня и суббота следующих выходных, а следующее воскресенье пропускалось (окно 7 дней).
-- Теперь, если слот выпадает на сегодняшний день недели, создаётся и сегодняшнее занятие, и такое же через неделю.
-- Вторничный запуск не меняется: в окне каждый слот встречается один раз. Остальное (идемпотентность, пропуски, постоянные) как в 0090.
create or replace function ind_autocreate(from_d date default null) returns int
language plpgsql security definer set search_path = public as $$
declare local_now timestamp := now() at time zone 'Asia/Tbilisi'; base date := coalesce(from_d, (now() at time zone 'Asia/Tbilisi')::date);
  r record; m record; d date; first_d date; ext text; sid uuid; th text; n int := 0;
begin
  for r in select * from individual_templates where active loop
    first_d := base + ((r.isodow - extract(isodow from base)::int + 7) % 7);
    for d in select first_d + k * 7 from generate_series(0, case when first_d = base then 1 else 0 end) as k loop
      if from_d is null and (d + r.start_time) < local_now then continue; end if;
      ext := ind_ext_id(d, r.start_time, r.goalkeepers);
      if exists (select 1 from individual_skips where club_id = r.club_id and external_id = ext) then continue; end if;
      th := case when coalesce(array_length(r.topics, 1), 0) = 0 then null
                 else r.topics[1 + ((d - date '2024-01-01') / 7) % array_length(r.topics, 1)] end;
      sid := null;
      insert into individual_sessions (club_id, external_id, starts_at, topic, goalkeepers, auto)
      values (r.club_id, ext, d + r.start_time, th, r.goalkeepers, true)
      on conflict (club_id, external_id) do nothing returning id into sid;
      if sid is null then continue; end if;
      n := n + 1;
      for m in select sm.player_id from individual_slot_members sm join players pl on pl.id = sm.player_id
                where sm.template_id = r.id and sm.month = date_trunc('month', d)::date and pl.status = 'active' loop
        begin perform ind_book(sid, m.player_id); exception when others then null; end;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke execute on function ind_autocreate(date) from public, anon, authenticated;
grant execute on function ind_autocreate(date) to service_role;
