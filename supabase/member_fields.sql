-- Champs supplémentaires des membres + stockage des photos.
-- À lancer une fois dans Supabase > SQL Editor.
-- Rappel : "locality" = Adresse, "function_name" = Fonction dans la section, "photo_url" = Photo (déjà existants).

alter table public.members add column if not exists study_field    text;  -- Filière
alter table public.members add column if not exists study_level    text;  -- Niveau d’étude
-- Section : on utilise la colonne existante members.section_id (liste public.sections)
alter table public.members add column if not exists join_year      int;   -- Année d’adhésion
alter table public.members add column if not exists guardian_phone text;  -- Numéro du tuteur
alter table public.members add column if not exists blood_group    text;  -- Groupe sanguin

-- Exemple : créer les sections (à adapter à tes noms)
-- insert into public.sections (organization_id, name)
-- select id, 'Section A' from public.organizations limit 1;

alter table public.members add column if not exists room_number text; -- Numéro de chambre
alter table public.members add column if not exists ufr text;  -- UFR (SAT, SJP, SEFS, SEG, S2ATA, CRAC, IPSL, 2S, Formation, LSH, Autre)

-- Reprise des anciennes sections quand leur nom correspond à une UFR
update public.members m set ufr = s.name
from public.sections s
where m.section_id = s.id and m.ufr is null
  and s.name in ('SAT','SJP','SEFS','SEG','S2ATA','CRAC','IPSL','2S','Formation','LSH','Autre');

-- Bucket public pour les photos
insert into storage.buckets (id, name, public)
values ('member-photos', 'member-photos', true)
on conflict (id) do nothing;

drop policy if exists member_photos_read on storage.objects;
create policy member_photos_read on storage.objects for select using (bucket_id = 'member-photos');

drop policy if exists member_photos_insert on storage.objects;
create policy member_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos' and public.is_staff());

drop policy if exists member_photos_update on storage.objects;
create policy member_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'member-photos' and public.is_staff());

-- Page publique de la carte : ajoute la photo (remplace la fonction de member_cards.sql)
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
    'member_number', m.member_number,
    'photo_url', m.photo_url
  );
end;
$$;