-- ============================================================
-- ACTIVITÉS RÉCURRENTES
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
--
-- Exemples déjà créés par ce script :
--   * GOUDI ALJUMAH : tous les jeudis à 21 h
--   * TOUR MJ       : tous les dimanches à 21 h
-- Les activités des 4 prochaines semaines sont créées automatiquement,
-- et la liste se complète à chaque ouverture de la page Activités.
-- Fuseau horaire utilisé : Africa/Dakar.
-- ============================================================

-- 1) Modèles de récurrence
create table if not exists public.recurring_activities (
  id               uuid primary key default gen_random_uuid(),
  activity_type_id uuid references public.activity_types(id) on delete set null,
  name             text not null,
  location         text,
  weekday          smallint not null check (weekday between 0 and 6),  -- 0 = dimanche, 1 = lundi ... 6 = samedi
  start_time       time not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  active           boolean not null default true,
  generated_until  date,   -- dernière date déjà générée (évite de recréer une activité supprimée à la main)
  created_at       timestamptz not null default now()
);

-- 2) Lien entre une activité et sa récurrence + protection contre les doublons
alter table public.activities
  add column if not exists recurring_id uuid references public.recurring_activities(id) on delete set null;

create unique index if not exists activities_recurring_unique
  on public.activities (recurring_id, start_datetime)
  where recurring_id is not null;

-- 3) Droits : tout utilisateur connecté lit, seuls admin et responsables modifient
alter table public.recurring_activities enable row level security;

drop policy if exists recurring_auth_read on public.recurring_activities;
create policy recurring_auth_read on public.recurring_activities
  for select to authenticated using (true);

drop policy if exists recurring_staff_insert on public.recurring_activities;
create policy recurring_staff_insert on public.recurring_activities
  for insert to authenticated with check (public.is_staff());

drop policy if exists recurring_staff_update on public.recurring_activities;
create policy recurring_staff_update on public.recurring_activities
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists recurring_staff_delete on public.recurring_activities;
create policy recurring_staff_delete on public.recurring_activities
  for delete to authenticated using (public.is_staff());

-- 4) Génération des activités à venir (peut être appelée plusieurs fois sans créer de doublons)
create or replace function public.generate_recurring_activities(p_weeks integer default 4)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  r        public.recurring_activities%rowtype;
  v_today  date := (now() at time zone 'Africa/Dakar')::date;
  v_to     date;
  v_from   date;
  d        date;
  v_start  timestamptz;
  v_count  integer := 0;
  v_ins    integer;
begin
  v_to := v_today + (greatest(p_weeks, 1) * 7);

  for r in select * from public.recurring_activities where active loop
    v_from := greatest(v_today, coalesce(r.generated_until + 1, v_today));
    d := v_from;

    while d <= v_to loop
      if extract(dow from d)::int = r.weekday then
        v_start := timezone('Africa/Dakar', d + r.start_time);

        -- on ne crée pas d'activité déjà largement passée
        if v_start > now() - interval '3 hours' then
          insert into public.activities
            (activity_type_id, name, location, start_datetime, end_datetime, recurring_id)
          values (
            r.activity_type_id,
            r.name,
            r.location,
            v_start,
            case when r.duration_minutes is not null
                 then v_start + make_interval(mins => r.duration_minutes) end,
            r.id
          )
          on conflict do nothing;

          get diagnostics v_ins = row_count;
          v_count := v_count + v_ins;
        end if;
      end if;
      d := d + 1;
    end loop;

    update public.recurring_activities set generated_until = v_to where id = r.id;
  end loop;

  return v_count;
end;
$$;

-- 5) Suppression d'une récurrence : supprime aussi ses activités À VENIR sans présences
--    (les activités passées ou déjà pointées sont conservées)
create or replace function public.delete_recurring_activity(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Droits insuffisants : réservé aux administrateurs et aux responsables.';
  end if;

  delete from public.activities a
  where a.recurring_id = p_id
    and a.start_datetime > now()
    and not exists (select 1 from public.attendance t where t.activity_id = a.id);

  delete from public.recurring_activities where id = p_id;
end;
$$;

revoke all on function public.generate_recurring_activities(integer) from public, anon;
revoke all on function public.delete_recurring_activity(uuid)        from public, anon;
grant execute on function public.generate_recurring_activities(integer) to authenticated;
grant execute on function public.delete_recurring_activity(uuid)        to authenticated;

-- 6) Vos deux récurrences
insert into public.recurring_activities (activity_type_id, name, weekday, start_time)
select t.id, t.name, 4, time '21:00'                       -- jeudi 21 h
from public.activity_types t
where t.name = 'GOUDI ALJUMAH'
  and not exists (
    select 1 from public.recurring_activities x
    where x.activity_type_id = t.id and x.weekday = 4 and x.start_time = time '21:00'
  );

insert into public.recurring_activities (activity_type_id, name, weekday, start_time)
select t.id, t.name, 0, time '21:00'                       -- dimanche 21 h
from public.activity_types t
where t.name = 'TOUR MJ'
  and not exists (
    select 1 from public.recurring_activities x
    where x.activity_type_id = t.id and x.weekday = 0 and x.start_time = time '21:00'
  );

-- 7) Création immédiate des activités des 4 prochaines semaines
select public.generate_recurring_activities(4);

-- 8) OPTIONNEL : génération automatique chaque jour à 00 h 05, même si personne n'ouvre le site.
--    Activez d'abord pg_cron : Database > Extensions > pg_cron, puis retirez les deux tirets :
select cron.schedule('generate-recurring-activities', '5 0 * * *', 'select public.generate_recurring_activities(4)');