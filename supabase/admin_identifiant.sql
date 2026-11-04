-- 1) Dans Supabase > Authentication > Users > "Add user" > "Create new user" :
--      Email    : admin143@mj-membres.app
--      Password : (le mot de passe choisi)
--      Cocher "Auto Confirm User"
-- 2) Puis exécuter ce script pour lui donner le rôle admin :
insert into public.profiles (id, email, first_name, last_name, role)
select id, email, 'Admin', 'Principal', 'admin'::public.app_role
from auth.users
where email = 'conseilugb@gmail.com'
on conflict (id) do update set role = 'admin'::public.app_role, is_active = true;
