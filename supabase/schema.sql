create extension if not exists pgcrypto;

-- 1. Création sécurisée des types ENUM (évite les erreurs si déjà créés)
do $$ 
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin','responsable','member');
  end if;
  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type public.member_status as enum ('active','inactive');
  end if;
  if not exists (select 1 from pg_type where typname = 'activity_status') then
    create type public.activity_status as enum ('prévue','en cours','terminée','annulée');
  end if;
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type public.attendance_status as enum ('Présent','Absent','Excusé');
  end if;
end $$;

-- 2. Création des tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  role public.app_role not null default 'member',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  logo_url text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  member_number text unique not null default ('MJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  gender text,
  birth_date date,
  locality text,
  function_name text,
  photo_url text,
  status public.member_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  activity_type_id uuid references public.activity_types(id) on delete set null,
  name text not null,
  description text,
  location text,
  start_datetime timestamptz not null default now(),
  end_datetime timestamptz,
  responsible_id uuid references public.profiles(id) on delete set null,
  status public.activity_status not null default 'prévue',
  qr_token text not null unique default encode(gen_random_bytes(24),'hex'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Correction du problème : Ajout explicite de start_datetime si la table existait déjà sans cette colonne
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'activities' and column_name = 'start_datetime'
  ) then
    alter table public.activities add column start_datetime timestamptz not null default now();
  end if;
end $$;

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status public.attendance_status not null default 'Absent',
  check_in_at timestamptz,
  recorded_by uuid references public.profiles(id) on delete set null,
  method text not null default 'manual' check (method in ('qr','manual')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(activity_id, member_id)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  module text not null,
  record_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid unique references public.organizations(id) on delete cascade,
  organization_name text,
  logo_url text,
  phone text,
  email text,
  updated_at timestamptz not null default now()
);

-- 3. Fonctions Helper
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active=true); $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','responsable') and is_active=true); $$;

-- 4. Activation RLS
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.sections enable row level security;
alter table public.members enable row level security;
alter table public.activity_types enable row level security;
alter table public.activities enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;

-- 5. Politiques de sécurité (RLS Policies)
drop policy if exists profiles_self_or_admin on public.profiles;
create policy profiles_self_or_admin on public.profiles for select using (id=auth.uid() or public.is_admin());

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists organizations_auth_read on public.organizations;
create policy organizations_auth_read on public.organizations for select to authenticated using (true);
drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists sections_staff on public.sections;
create policy sections_staff on public.sections for select to authenticated using (true);
drop policy if exists sections_admin_write on public.sections;
create policy sections_admin_write on public.sections for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists members_auth_read on public.members;
create policy members_auth_read on public.members for select to authenticated using (true);
drop policy if exists members_staff_write on public.members;
create policy members_staff_write on public.members for insert to authenticated with check (public.is_staff());
drop policy if exists members_staff_update on public.members;
create policy members_staff_update on public.members for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists members_admin_delete on public.members;
create policy members_admin_delete on public.members for delete to authenticated using (public.is_admin());

drop policy if exists activity_types_auth_read on public.activity_types;
create policy activity_types_auth_read on public.activity_types for select to authenticated using (true);
drop policy if exists activity_types_staff_write on public.activity_types;
create policy activity_types_staff_write on public.activity_types for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists activities_auth_read on public.activities;
create policy activities_auth_read on public.activities for select to authenticated using (true);
drop policy if exists activities_staff_write on public.activities;
create policy activities_staff_write on public.activities for insert to authenticated with check (public.is_staff());
drop policy if exists activities_staff_update on public.activities;
create policy activities_staff_update on public.activities for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists activities_admin_delete on public.activities;
create policy activities_admin_delete on public.activities for delete to authenticated using (public.is_admin());

drop policy if exists attendance_auth_read on public.attendance;
create policy attendance_auth_read on public.attendance for select to authenticated using (true);
drop policy if exists attendance_staff_insert on public.attendance;
create policy attendance_staff_insert on public.attendance for insert to authenticated with check (public.is_staff());
drop policy if exists attendance_staff_update on public.attendance;
create policy attendance_staff_update on public.attendance for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists audit_staff_read on public.audit_logs;
create policy audit_staff_read on public.audit_logs for select to authenticated using (public.is_staff());
drop policy if exists audit_insert_auth on public.audit_logs;
create policy audit_insert_auth on public.audit_logs for insert to authenticated with check (user_id=auth.uid());

drop policy if exists settings_auth_read on public.app_settings;
create policy settings_auth_read on public.app_settings for select to authenticated using (true);
drop policy if exists settings_admin_write on public.app_settings;
create policy settings_admin_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 6. Index
create index if not exists members_name_idx on public.members(last_name, first_name);
create index if not exists attendance_activity_idx on public.attendance(activity_id);
create index if not exists attendance_member_idx on public.attendance(member_id);
create index if not exists activities_start_idx on public.activities(start_datetime);

-- Après création d'un utilisateur dans Authentication > Users,
-- créer son profil, par exemple :
-- nsert into public.profiles (id,email,first_name,last_name,role)
-- values ('UUID_AUTH_USER','email@example.com','Admin','Principal','admin');
-- Insérer ou mettre à jour le profil administrateur
insert into public.profiles (id, email, first_name, last_name, role)
select id, email, 'Admin', 'Principal', 'admin'::public.app_role
from auth.users where email = 'conseilugb@gmail.com'
on conflict (id) do update set role = 'admin'::public.app_role;

-- Créer l'organisation (évite le doublon si vous relancez le script)
insert into public.organizations (name)
select 'Moustarchidine Junior'
where not exists (
  select 1 from public.organizations where name = 'Moustarchidine Junior'
);-- ============================================================
-- ACCÈS PUBLIC (sans connexion) — à exécuter dans Supabase > SQL Editor
-- Public : statistiques, activités (voir/créer/modifier), présences (voir/marquer)
-- Protégé (connexion obligatoire) : fiches des membres, exports, utilisateurs, journal, paramètres
-- ============================================================

-- Activités : lecture, création et modification ouvertes à tous (la suppression reste réservée à l'admin connecté)
drop policy if exists activities_public_read on public.activities;
create policy activities_public_read on public.activities for select to anon using (true);
drop policy if exists activities_public_insert on public.activities;
create policy activities_public_insert on public.activities for insert to anon with check (created_by is null and responsible_id is null);
drop policy if exists activities_public_update on public.activities;
create policy activities_public_update on public.activities for update to anon using (true) with check (created_by is null and responsible_id is null);

-- Présences : lecture et marquage ouverts à tous (aucun nom dans cette table)
drop policy if exists attendance_public_read on public.attendance;
create policy attendance_public_read on public.attendance for select to anon using (true);
drop policy if exists attendance_public_insert on public.attendance;
create policy attendance_public_insert on public.attendance for insert to anon with check (recorded_by is null);
drop policy if exists attendance_public_update on public.attendance;
create policy attendance_public_update on public.attendance for update to anon using (true) with check (recorded_by is null);

-- La table "members" reste PRIVÉE (téléphone, e-mail, naissance...).
-- Le public ne reçoit que prénom + nom des membres actifs, via cette fonction.
create or replace function public.public_member_names()
returns table (id uuid, first_name text, last_name text)
language sql stable security definer set search_path = public
as $$
  select m.id, m.first_name, m.last_name
  from public.members m
  where m.status = 'active'
  order by m.last_name, m.first_name;
$$;

-- Statistiques globales (uniquement des totaux)
create or replace function public.public_stats()
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object(
    'members',          (select count(*) from public.members),
    'active',           (select count(*) from public.members where status = 'active'),
    'inactive',         (select count(*) from public.members where status = 'inactive'),
    'activities',       (select count(*) from public.activities),
    'present',          (select count(*) from public.attendance where status = 'Présent'),
    'absent',           (select count(*) from public.attendance where status = 'Absent'),
    'excused',          (select count(*) from public.attendance where status = 'Excusé'),
    'attendance_total', (select count(*) from public.attendance)
  );
$$;

revoke all on function public.public_member_names() from public;
revoke all on function public.public_stats() from public;
grant execute on function public.public_member_names() to anon, authenticated;
grant execute on function public.public_stats() to anon, authenticated;
-- Types d'activités fixes (à exécuter dans Supabase > SQL Editor)
insert into public.activity_types (name)
select t.name from (values ('GOUDI ALJUMAH'),('KHADARA'),('SPORT'),('CELLULE FÉMININ'),('TOUR MJ'),('AUTRE')) as t(name)
where not exists (select 1 from public.activity_types x where x.name = t.name);

-- Lecture des types ouverte à tous (nécessaire pour les pages publiques)
drop policy if exists activity_types_public_read on public.activity_types;
create policy activity_types_public_read on public.activity_types for select to anon using (true);


-- Supprimer l'ancien compte
delete from auth.users where email = 'admin143@mj-membres.app';

-- Donner le rôle admin au compte Gmail
insert into public.profiles (id, email, first_name, last_name, role)
select id, email, 'Admin', 'Principal', 'admin'::public.app_role
from auth.users where email = 'conseilugb@gmail.com'
on conflict (id) do update set role = 'admin', is_active = true;

-- Confirmer le compte
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email = 'conseilugb@gmail.com';

-- Vérification : doit afficher 1 ligne avec role = admin
select id, email, role, is_active from public.profiles
where email = 'conseilugb@gmail.com';

