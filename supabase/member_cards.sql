-- ============================================================
-- CARTES DE MEMBRE AVEC QR PERSONNEL
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
--
--  * chaque membre reçoit un jeton secret et unique (son QR code) ;
--  * un administrateur ou un responsable scanne la carte à l'entrée :
--    le membre est marqué « Présent » (méthode qr) ;
--  * la carte peut être régénérée si elle est perdue ou partagée ;
--  * un membre « ancien » (masqué) ne peut plus être pointé.
-- ============================================================

-- 1) Jeton personnel de chaque membre
alter table public.members add column if not exists qr_token text;

update public.members
set qr_token = replace(gen_random_uuid()::text, '-', '')
where qr_token is null;

alter table public.members
  alter column qr_token set default replace(gen_random_uuid()::text, '-', ''),
  alter column qr_token set not null;

create unique index if not exists members_qr_token_key on public.members (qr_token);

-- 2) Pointage par scan de la carte (réservé aux administrateurs et responsables)
create or replace function public.checkin_by_card(p_activity_id uuid, p_token text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  a        public.activities%rowtype;
  m        public.members%rowtype;
  v_status text;
begin
  if not public.is_staff() then
    return json_build_object('ok', false, 'message', 'Réservé aux administrateurs et aux responsables.');
  end if;

  select * into a from public.activities where id = p_activity_id;
  if not found then
    return json_build_object('ok', false, 'message', 'Activité introuvable.');
  end if;
  if a.status = 'annulée' then
    return json_build_object('ok', false, 'message', 'Cette activité est annulée.');
  end if;

  select * into m from public.members where qr_token = p_token;
  if not found then
    return json_build_object('ok', false, 'message', 'Carte inconnue ou désactivée.');
  end if;
  if m.status <> 'active' then
    return json_build_object('ok', false, 'name', m.first_name || ' ' || m.last_name,
                             'message', 'Ancien membre : carte non valide.');
  end if;

  select status::text into v_status
  from public.attendance
  where activity_id = a.id and member_id = m.id;

  if v_status = 'Présent' then
    return json_build_object('ok', true, 'already', true, 'name', m.first_name || ' ' || m.last_name,
                             'message', 'Déjà pointé(e).');
  end if;

  insert into public.attendance (activity_id, member_id, status, method, check_in_at, recorded_by)
  values (a.id, m.id, 'Présent', 'qr', now(), auth.uid())
  on conflict (activity_id, member_id)
  do update set status = 'Présent',
                method = 'qr',
                check_in_at = coalesce(public.attendance.check_in_at, now()),
                recorded_by = auth.uid(),
                updated_at = now();

  return json_build_object('ok', true, 'already', false, 'name', m.first_name || ' ' || m.last_name,
                           'message', 'Présence enregistrée.');
end;
$$;

-- 3) Page publique de la carte (lien envoyé au membre) : nom, numéro et validité seulement
create or replace function public.public_member_card(p_token text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  m public.members%rowtype;
begin
  select * into m from public.members where qr_token = p_token;
  if not found then
    return json_build_object('found', false);
  end if;
  return json_build_object(
    'found', true,
    'active', (m.status = 'active'),
    'first_name', m.first_name,
    'last_name', m.last_name,
    'member_number', m.member_number
  );
end;
$$;

-- 4) Nouvelle carte (carte perdue ou partagée) : l'ancien QR cesse de fonctionner
create or replace function public.regenerate_member_card(p_member_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_staff() then
    raise exception 'Droits insuffisants : réservé aux administrateurs et aux responsables.';
  end if;
  update public.members set qr_token = v_token, updated_at = now() where id = p_member_id;
  return v_token;
end;
$$;

-- 5) Droits
revoke all on function public.checkin_by_card(uuid, text)      from public, anon;
revoke all on function public.regenerate_member_card(uuid)     from public, anon;
revoke all on function public.public_member_card(text)         from public;

grant execute on function public.checkin_by_card(uuid, text)   to authenticated;
grant execute on function public.regenerate_member_card(uuid)  to authenticated;
grant execute on function public.public_member_card(text)      to anon, authenticated;