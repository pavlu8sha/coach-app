-- Откат 0219: убрать player_group_since(). Уже перенесённые границы групп и пересозданные начисления остаются (журнал неизменен).
drop function if exists player_group_since(uuid, date, boolean);
