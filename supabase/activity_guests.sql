-- ============================================================
-- INVITÉS (PERSONNES EXTÉRIEURES À L'ORGANISATION) PAR ACTIVITÉ
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
--
-- Pour chaque activité, un responsable enregistre seulement le NOM et le PRÉNOM
-- des personnes qui ne sont pas membres. Elles sont enregistrées à part :
-- elles ne comptent PAS dans les statistiques des membres.
--
-- Si vous aviez déjà lancé une version précédente de ce script, vous n'avez
-- rien à refaire : les colonnes en trop restent simplement inutilisées.
-- ============================================================

create table if not exists public.activity_guests (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists activity_guests_activity_idx on public.activity_guests (activity_id);

-- Pas deux fois le même nom et prénom dans une même activité
create unique index if not exists activity_guests_unique
  on public.activity_guests (activity_id, lower(btrim(first_name)), lower(btrim(last_name)));

-- Droits : tout utilisateur connecté lit, seuls admin et responsables modifient
alter table public.activity_guests enable row level security;

drop policy if exists guests_auth_read on public.activity_guests;
create policy guests_auth_read on public.activity_guests
  for select to authenticated using (true);

drop policy if exists guests_staff_insert on public.activity_guests;
create policy guests_staff_insert on public.activity_guests
  for insert to authenticated with check (public.is_staff());

drop policy if exists guests_staff_update on public.activity_guests;
create policy guests_staff_update on public.activity_guests
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists guests_staff_delete on public.activity_guests;
create policy guests_staff_delete on public.activity_guests
  for delete to authenticated using (public.is_staff());