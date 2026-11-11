-- #238, PR 2a: можно ли применять миграцию 0162. Только чтение, ничего не меняет. Запустить в SQL Editor целиком.
-- Все строки должны быть true: 0159 (модель согласий) и 0148-0152 применены. Если есть false, 0162 не применять.
select * from (values
  ('0159_consent_model применена', coalesce((to_regclass('parental_consents') is not null and to_regclass('parental_consent_events') is not null and to_regclass('consent_doc_versions') is not null and to_regproc('my_data_consent_ok') is not null), false)),
  ('0148_booking_notifications применена', coalesce((to_regproc('booking_family_notice') is not null), false)),
  ('0149_booking_waitlist применена', coalesce((to_regproc('waitlist_claim') is not null), false)),
  ('0150_individual_times применена', coalesce((to_regproc('booking_conflicts') is not null), false)),
  ('0151_first_wave применена', coalesce((to_regproc('first_wave_friday') is not null), false)),
  ('0152_waitlist_bot_button применена', coalesce((to_regproc('waitlist_claim_by_telegram') is not null), false)),
  ('0162 ещё не применена (true = применять можно)', coalesce((to_regproc('accept_consent') is null), false))
) as t(check_name, ok)
order by check_name;
