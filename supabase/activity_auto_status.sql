-- ============================================================
-- STATUT AUTOMATIQUE DES ACTIVITÉS
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor > New query > Run
--
-- Règles :
--  * prévue    : avant l'heure de début ;
--  * en cours  : à partir du début ;
--  * terminée  : dès l'heure de FIN (ou 4 h après le DÉBUT s'il n'y a pas d'heure de fin),
--                comme la fermeture du pointage par QR code ;
--  * annulée   : choisie à la main (case « Activité annulée »), jamais modifiée par l'automatique.
-- Les activités terminées restent modifiables.
-- Pour changer la durée sans heure de fin, remplacez « 4 hours » ci-dessous.
-- ============================================================

-- 0) Nettoyage éventuel d'une version précédente qui verrouillait les activités
drop trigger if exists trg_activities_lock on public.activities;
drop function if exists public.activities_lock_guard();

-- 1) Mise à jour des statuts
create or replace function public.refresh_activity_status()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.activities
     set status = 'terminée'
   where status in ('prévue', 'en cours')
     and now() >= coalesce(end_datetime, start_datetime + interval '4 hours');

  update public.activities
     set status = 'en cours'
   where status = 'prévue'
     and now() >= start_datetime;
end;
$$;

revoke all on function public.refresh_activity_status() from public, anon;
grant execute on function public.refresh_activity_status() to authenticated;

-- 2) Mise à jour immédiate des activités existantes
select public.refresh_activity_status();

-- 3) OPTIONNEL : mise à jour automatique toutes les 10 minutes, même si personne
--    n'ouvre le site. Activez d'abord pg_cron : Database > Extensions > pg_cron,
--    puis retirez les deux tirets devant la ligne suivante.
 select cron.schedule('refresh-activity-status', '*/10 * * * *', 'select public.refresh_activity_status()');

 