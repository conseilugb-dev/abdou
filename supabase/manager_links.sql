-- ============================================================
-- LIEN RESPONSABLE PAR ACTIVITÉ (sans mot de passe)
-- À exécuter UNE FOIS dans Supabase > SQL Editor > New query > Run
-- (peut être relancé sans risque)
--
-- Principe :
--  * à la création d'une activité, un lien secret est généré automatiquement ;
--  * le lien est donné aux 2 responsables de l'activité ; il ouvre UNIQUEMENT
--    la feuille d'appel de CETTE activité (rien d'autre sur le site) ;
--  * le lien ne fonctionne que de 1 h avant le début jusqu'à 3 h après la fin
--    (sans heure de fin : 4 h après le début) ;
--  * l'administrateur peut désactiver ou régénérer le lien à tout moment ;
--  * chaque modification de présence faite par ce lien est inscrite au journal ;
--  * le lien ne donne accès qu'aux prénoms/noms : jamais téléphone, e-mail, etc.
-- ============================================================

-- 1) Table des liens (aucune lecture directe depuis le navigateur)
create table if not exists public.activity_manager_links (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  revoked     boolean not null default false,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.activity_manager_links enable row level security;
-- Volontairement AUCUNE politique : tout passe par les fonctions ci-dessous.

-- 2) Un lien est créé automatiquement pour chaque nouvelle activité
create or replace function public.trg_create_manager_link()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.activity_manager_links (activity_id)
  values (new.id)
  on conflict (activity_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_activities_manager_link on public.activities;
create trigger trg_activities_manager_link
  after insert on public.activities
  for each row execute function public.trg_create_manager_link();

-- ... et pour les activités déjà existantes
insert into public.activity_manager_links (activity_id)
select id from public.activities
on conflict (activity_id) do nothing;

-- 3) Fenêtre d'utilisation du lien : ok / early / late / cancelled
create or replace function public.ml_window_state(p_status text, p_start timestamptz, p_end timestamptz)
returns text
language plpgsql stable set search_path = public
as $$
begin
  if p_status = 'annulée' then
    return 'cancelled';
  end if;
  if now() < p_start - interval '1 hour' then
    return 'early';
  end if;
  if now() > coalesce(p_end, p_start + interval '4 hours') + interval '3 hours' then
    return 'late';
  end if;
  return 'ok';
end;
$$;

-- 4) Feuille d'appel (appelée avec le lien, sans connexion)
create or replace function public.ml_sheet(p_token text)
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  l       public.activity_manager_links%rowtype;
  a       public.activities%rowtype;
  v_state text;
begin
  select * into l from public.activity_manager_links where token = p_token;
  if not found or l.revoked then
    return json_build_object('found', false);
  end if;

  select * into a from public.activities where id = l.activity_id;
  v_state := public.ml_window_state(a.status::text, a.start_datetime, a.end_datetime);

  if v_state <> 'ok' then
    return json_build_object('found', true, 'name', a.name, 'start', a.start_datetime, 'state', v_state);
  end if;

  return json_build_object(
    'found', true,
    'name',  a.name,
    'start', a.start_datetime,
    'state', 'ok',
    'members', (
      select coalesce(json_agg(json_build_object(
               'id', m.id,
               'first_name', m.first_name,
               'last_name', m.last_name,
               'status', att.status::text
             ) order by m.last_name, m.first_name), '[]'::json)
      from public.members m
      left join public.attendance att
        on att.member_id = m.id and att.activity_id = a.id
      where m.status = 'active'
    )
  );
end;
$$;

-- 5) Marquer un membre (Présent / Absent / Excusé) avec le lien
create or replace function public.ml_mark(p_token text, p_member_id uuid, p_status text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  l       public.activity_manager_links%rowtype;
  a       public.activities%rowtype;
  m       public.members%rowtype;
  v_state text;
begin
  if p_status not in ('Présent', 'Absent', 'Excusé') then
    return json_build_object('ok', false, 'message', 'Statut invalide.');
  end if;

  select * into l from public.activity_manager_links where token = p_token;
  if not found or l.revoked then
    return json_build_object('ok', false, 'message', 'Lien invalide ou désactivé.');
  end if;

  select * into a from public.activities where id = l.activity_id;
  v_state := public.ml_window_state(a.status::text, a.start_datetime, a.end_datetime);
  if v_state = 'cancelled' then
    return json_build_object('ok', false, 'message', 'Cette activité est annulée.');
  elsif v_state = 'early' then
    return json_build_object('ok', false, 'message', 'Le lien s''ouvre 1 heure avant le début.');
  elsif v_state = 'late' then
    return json_build_object('ok', false, 'message', 'Le lien est expiré : l''activité est terminée.');
  end if;

  select * into m from public.members where id = p_member_id and status = 'active';
  if not found then
    return json_build_object('ok', false, 'message', 'Membre introuvable.');
  end if;

  insert into public.attendance (activity_id, member_id, status, method, check_in_at, recorded_by)
  values (a.id, m.id, p_status::public.attendance_status, 'manual',
          case when p_status = 'Présent' then now() else null end, null)
  on conflict (activity_id, member_id)
  do update set status      = excluded.status,
                method      = 'manual',
                check_in_at = case when excluded.status = 'Présent'
                                   then coalesce(public.attendance.check_in_at, now())
                                   else null end,
                updated_at  = now();

  update public.activity_manager_links set last_used_at = now() where activity_id = a.id;

  insert into public.audit_logs (user_id, action, module, record_id, details)
  values (null, 'attendance_via_manager_link', 'attendance', a.id,
          jsonb_build_object('member_id', m.id,
                             'member', m.first_name || ' ' || m.last_name,
                             'status', p_status));

  return json_build_object('ok', true, 'status', p_status);
end;
$$;

-- 6) Côté administration (connecté) : voir / régénérer / désactiver le lien
create or replace function public.get_manager_link(p_activity_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  l public.activity_manager_links%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Réservé aux administrateurs et aux responsables.';
  end if;
  insert into public.activity_manager_links (activity_id)
  values (p_activity_id)
  on conflict (activity_id) do nothing;
  select * into l from public.activity_manager_links where activity_id = p_activity_id;
  return json_build_object('token', l.token, 'revoked', l.revoked, 'last_used_at', l.last_used_at);
end;
$$;

create or replace function public.regenerate_manager_link(p_activity_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  if not public.is_staff() then
    raise exception 'Réservé aux administrateurs et aux responsables.';
  end if;
  update public.activity_manager_links
     set token = v_token, revoked = false, last_used_at = null
   where activity_id = p_activity_id;
  return json_build_object('token', v_token, 'revoked', false, 'last_used_at', null);
end;
$$;

create or replace function public.set_manager_link_revoked(p_activity_id uuid, p_revoked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Réservé aux administrateurs et aux responsables.';
  end if;
  update public.activity_manager_links set revoked = p_revoked where activity_id = p_activity_id;
end;
$$;

-- 7) Droits
revoke all on function public.trg_create_manager_link()                      from public, anon, authenticated;
revoke all on function public.ml_window_state(text, timestamptz, timestamptz) from public;
revoke all on function public.ml_sheet(text)                                  from public;
revoke all on function public.ml_mark(text, uuid, text)                       from public;
revoke all on function public.get_manager_link(uuid)                          from public, anon;
revoke all on function public.regenerate_manager_link(uuid)                   from public, anon;
revoke all on function public.set_manager_link_revoked(uuid, boolean)         from public, anon;

grant execute on function public.ml_window_state(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.ml_sheet(text)                               to anon, authenticated;
grant execute on function public.ml_mark(text, uuid, text)                    to anon, authenticated;
grant execute on function public.get_manager_link(uuid)                       to authenticated;
grant execute on function public.regenerate_manager_link(uuid)                to authenticated;
grant execute on function public.set_manager_link_revoked(uuid, boolean)      to authenticated;