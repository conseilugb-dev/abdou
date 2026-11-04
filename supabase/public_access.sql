-- Accès public désactivé : l'application exige une connexion.
-- Ne pas recréer les politiques "to anon".
drop policy if exists activities_public_read on public.activities;
drop policy if exists activities_public_insert on public.activities;
drop policy if exists activities_public_update on public.activities;
drop policy if exists attendance_public_read on public.attendance;
drop policy if exists attendance_public_insert on public.attendance;
drop policy if exists attendance_public_update on public.attendance;
drop policy if exists activity_types_public_read on public.activity_types;

revoke execute on function public.public_member_names() from anon;
revoke execute on function public.public_stats() from anon;