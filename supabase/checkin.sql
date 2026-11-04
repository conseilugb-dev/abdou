-- ============================================================
-- POINTAGE PAR QR CODE
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
--
-- Règles :
--  * le pointage est ouvert de 30 min avant le début jusqu'à la fin de l'activité
--    (si aucune fin n'est renseignée : 4 h après le début) ;
--  * le membre choisit son nom puis tape les 4 DERNIERS CHIFFRES de son téléphone
--    (le numéro doit être renseigné dans la fiche du membre) ;
--  * après 5 codes faux, le membre est bloqué pour cette activité.
-- Ces fonctions fonctionnent SANS connexion : les tables restent privées.
-- ============================================================

-- 1) Table qui compte les mauvais codes (jamais lisible depuis le navigateur)
create table if not exists public.checkin_failures (
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  failures    int  not null default 0,
  primary key (activity_id, member_id)
);
alter table public.checkin_failures enable row level security;

-- 2) État du pointage d'une activité : ok / early / late / cancelled
create or replace function public.checkin_state(a public.activities)
returns text
language plpgsql stable security definer set search_path = public
as $$
begin
  if a.status = 'annulée' then
    return 'cancelled';
  end if;
  if now() < a.start_datetime - interval '30 minutes' then
    return 'early';
  end if;
  if now() > coalesce(a.end_datetime, a.start_datetime + interval '4 hours') then
    return 'late';
  end if;
  return 'ok';
end;
$$;

-- 3) Infos de l'activité à partir du token du QR code
create or replace function public.checkin_info(p_token text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  a public.activities%rowtype;
begin
  select * into a from public.activities where qr_token = p_token;
  if not found then
    return json_build_object('found', false);
  end if;
  return json_build_object(
    'found', true,
    'name',  a.name,
    'start', a.start_datetime,
    'state', public.checkin_state(a)
  );
end;
$$;

-- 4) Liste des noms (uniquement si le pointage est ouvert)
create or replace function public.checkin_members(p_token text)
returns table (id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public
as $$
  select m.id, m.first_name, m.last_name
  from public.members m
  where m.status = 'active'
    and exists (
      select 1 from public.activities a
      where a.qr_token = p_token and public.checkin_state(a) = 'ok'
    )
  order by m.last_name, m.first_name;
$$;

-- 5) Enregistrement de la présence
create or replace function public.checkin(p_token text, p_member_id uuid, p_code text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  a        public.activities%rowtype;
  m        public.members%rowtype;
  v_state  text;
  v_fail   int;
  v_phone  text;
  v_digits text;
begin
  select * into a from public.activities where qr_token = p_token;
  if not found then
    return json_build_object('ok', false, 'message', 'QR code invalide.');
  end if;

  v_state := public.checkin_state(a);
  if v_state = 'cancelled' then
    return json_build_object('ok', false, 'message', 'Cette activité est annulée.');
  elsif v_state = 'early' then
    return json_build_object('ok', false, 'message', 'Le pointage n''est pas encore ouvert.');
  elsif v_state = 'late' then
    return json_build_object('ok', false, 'message', 'Le pointage est fermé.');
  end if;

  select * into m from public.members where id = p_member_id and status = 'active';
  if not found then
    return json_build_object('ok', false, 'message', 'Membre introuvable.');
  end if;

  select failures into v_fail
  from public.checkin_failures
  where activity_id = a.id and member_id = m.id;
  if coalesce(v_fail, 0) >= 5 then
    return json_build_object('ok', false, 'message', 'Trop d''essais. Demande à un responsable de te marquer présent.');
  end if;

  v_phone  := regexp_replace(coalesce(m.phone, ''), '\D', '', 'g');
  v_digits := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');

  if length(v_phone) < 4 then
    return json_build_object('ok', false, 'message', 'Aucun numéro de téléphone enregistré pour toi. Demande à un responsable.');
  end if;

  if length(v_digits) <> 4 or right(v_phone, 4) <> v_digits then
    insert into public.checkin_failures (activity_id, member_id, failures)
    values (a.id, m.id, 1)
    on conflict (activity_id, member_id)
    do update set failures = public.checkin_failures.failures + 1;
    return json_build_object('ok', false, 'message', 'Code incorrect.');
  end if;

  insert into public.attendance (activity_id, member_id, status, method, check_in_at)
  values (a.id, m.id, 'Présent', 'qr', now())
  on conflict (activity_id, member_id)
  do update set status = 'Présent',
                method = 'qr',
                check_in_at = coalesce(public.attendance.check_in_at, now()),
                updated_at = now();

  delete from public.checkin_failures where activity_id = a.id and member_id = m.id;

  return json_build_object(
    'ok', true,
    'message', 'Présence enregistrée, ' || m.first_name || ' !'
  );
end;
$$;

-- 6) Droits : seules les 3 fonctions publiques sont appelables sans connexion
revoke all on function public.checkin_state(public.activities) from public, anon, authenticated;
revoke all on function public.checkin_info(text)               from public;
revoke all on function public.checkin_members(text)            from public;
revoke all on function public.checkin(text, uuid, text)        from public;

grant execute on function public.checkin_info(text)            to anon, authenticated;
grant execute on function public.checkin_members(text)         to anon, authenticated;
grant execute on function public.checkin(text, uuid, text)     to anon, authenticated;