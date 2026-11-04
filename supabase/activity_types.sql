-- Types d'activités fixes (à exécuter dans Supabase > SQL Editor)
insert into public.activity_types (name)
select t.name from (values ('GOUDI ALJUMAH'),('KHADARA'),('SPORT'),('CELLULE FÉMININ'),('TOUR MJ'),('AUTRE')) as t(name)
where not exists (select 1 from public.activity_types x where x.name = t.name);

-- Lecture des types ouverte à tous (nécessaire pour les pages publiques)
drop policy if exists activity_types_public_read on public.activity_types;
create policy activity_types_public_read on public.activity_types for select to anon using (true);
