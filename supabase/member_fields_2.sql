-- Nouveaux champs des membres : Boursier, Maladie chronique / allergies.
-- (Sexe = colonne "gender" et Poste dans la section de base = colonne "function_name" existent déjà.)
-- À lancer une fois dans Supabase > SQL Editor. Peut être relancé sans risque.

alter table public.members add column if not exists scholarship   text;  -- Boursier : Oui / Non
alter table public.members add column if not exists medical_notes text;  -- Maladie chronique ou allergies

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'members_scholarship_check') then
    alter table public.members add constraint members_scholarship_check check (scholarship in ('Oui','Non'));
  end if;
end $$;

-- Harmonise les anciens sexes saisis en M / F
update public.members set gender = 'Masculin' where upper(trim(gender)) in ('M','H');
update public.members set gender = 'Féminin'  where upper(trim(gender)) = 'F';