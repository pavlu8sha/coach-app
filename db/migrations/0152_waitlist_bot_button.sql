-- Кнопка «Занять место» в сообщении бота при освобождении места в очереди (Issue #274, PR 12).
-- Сообщение об освободившемся месте (0149) получает кнопки: по одной на ребёнка родителя, данные «w:<id позиции очереди>».
-- Нажатие обрабатывает tg-bot через waitlist_claim_by_telegram: та же атомарная проверка, что и в приложении (waitlist_claim),
-- от имени родителя, нажавшего кнопку. Опоздавший получает ответ «место уже занято» и остаётся в очереди.
-- Сообщения по-прежнему подчиняются booking.notify и общему выключателю родителя.

create or replace function waitlist_notify(k text, s uuid, moved boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare st record; lbl text; r record; head text; tail text; btn jsonb; any_free boolean;
begin
  select * into st from waitlist_state(k, s);
  if st.club_id is null or st.cancelled or st.starts_at <= now() at time zone 'Asia/Tbilisi' then return; end if;
  if not exists (select 1 from booking_waitlist where session_id = s) then return; end if;
  if not booking_notify_enabled(st.club_id) then return; end if;
  lbl := booking_session_label(k, s);
  any_free := st.free > 0;
  if not any_free and not moved then return; end if;
  for r in
    select g.user_id, string_agg(pl.full_name, ', ' order by pl.full_name) as names,
           jsonb_agg(jsonb_build_array(jsonb_build_object('text', 'Занять место: ' || coalesce(nullif(split_part(pl.full_name, ' ', 2), ''), pl.full_name), 'data', 'w:' || w.id)) order by pl.full_name) as btns
      from booking_waitlist w
      join players pl on pl.id = w.player_id
      join player_guardians g on g.player_id = w.player_id and g.consent_revoked_at is null
     where w.session_id = s
     group by g.user_id
  loop
    if any_free then
      head := case when moved then 'Занятие перенесено, есть свободное место: ' else 'Освободилось место: ' end;
      tail := ' — ' || lbl || '. Нажмите кнопку или подтвердите в приложении (Запись на занятия): место получит тот, кто подтвердит первым. Предложение действует до начала занятия.';
      btn := r.btns;
    else
      head := 'Занятие перенесено: ';
      tail := ' — ' || lbl || '. Вы остаётесь в очереди.';
      btn := null;
    end if;
    if exists (select 1 from users u where u.id = r.user_id and u.notifications_enabled) then
      insert into notifications (user_id, kind, text, buttons)
        values (r.user_id, case when any_free then 'waitlist_offer' else 'waitlist_moved' end, head || r.names || tail, btn);
    end if;
  end loop;
end $$;
revoke execute on function waitlist_notify(text, uuid, boolean) from public, anon, authenticated;

-- Нажатие кнопки в боте. Возвращает { ok, player, label } или { ok: false, code }.
create or replace function waitlist_claim_by_telegram(p_telegram_id bigint, p_waitlist uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid; w booking_waitlist; pl text; lbl text;
begin
  select id into u from users where telegram_id = p_telegram_id;
  if u is null then return jsonb_build_object('ok', false, 'code', 'unknown_user'); end if;
  select * into w from booking_waitlist where id = p_waitlist;
  if w.id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform waitlist_claim(w.kind, w.session_id, w.player_id);
  exception when others then
    return jsonb_build_object('ok', false, 'code',
      case when sqlerrm like '%session full%' then 'full'
           when sqlerrm like '%session in the past%' or sqlerrm like '%session cancelled%' then 'closed'
           when sqlerrm like '%not in waitlist%' then 'not_found'
           when sqlerrm like '%not eligible%' or sqlerrm like '%player not active%' then 'not_allowed'
           when sqlstate = '42501' then 'forbidden' else 'error' end);
  end;
  select full_name into pl from players where id = w.player_id;
  lbl := booking_session_label(w.kind, w.session_id);
  return jsonb_build_object('ok', true, 'player', pl, 'label', lbl);
end $$;
revoke execute on function waitlist_claim_by_telegram(bigint, uuid) from public, anon, authenticated;
grant execute on function waitlist_claim_by_telegram(bigint, uuid) to service_role;
