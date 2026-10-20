-- Run manually in Supabase SQL Editor as the project owner.
-- Restores the requested Super Admin credentials: username=admin, password=admin.
-- This script uses Supabase Auth's password hash format and is safe to run again.
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  target_id uuid;
  other_admin_id uuid;
  target_email text;
  crypto_schema text;
  password_hash text;
  new_username text;
  bootstrap_password text := 'admin';
begin
  select n.nspname into crypto_schema
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'crypt' and p.pronargs = 2
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'text, text'
  order by case when n.nspname = 'extensions' then 0 when n.nspname = 'public' then 1 else 2 end
  limit 1;
  if crypto_schema is null then raise exception 'pgcrypto crypt() is not available'; end if;

  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', crypto_schema, crypto_schema)
    into password_hash using bootstrap_password;

  -- Prefer the existing Super Admin. If none exists, reclaim an existing
  -- username=admin profile, then fall back to an Auth user with this email.
  select user_id into target_id from public.user_profiles
  where role_key = 'super_admin' and lower(username) = 'admin' limit 1;
  if target_id is null then
    select user_id into target_id from public.user_profiles
    where role_key = 'super_admin' order by created_at limit 1;
  end if;
  if target_id is null then
    select user_id into target_id from public.user_profiles
    where lower(username) = 'admin' limit 1;
  end if;
  if target_id is null then
    select id into target_id from auth.users where lower(email) = 'super-admin@vtn-portal.invalid' limit 1;
  end if;

  if target_id is null then
    target_id := gen_random_uuid();
    target_email := 'super-admin@vtn-portal.invalid';
    insert into auth.users (
      id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      target_id, 'authenticated', 'authenticated', target_email, password_hash, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"username":"admin","full_name":"Super Admin","role_key":"super_admin"}'::jsonb,
      now(), now()
    );
  else
    select email into target_email from auth.users where id = target_id;
    if target_email is null then raise exception 'The selected profile has no matching Supabase Auth user'; end if;

    select user_id into other_admin_id from public.user_profiles
      where lower(username) = 'admin' and user_id <> target_id limit 1;
    if other_admin_id is not null then
      new_username := 'recovered_' || left(other_admin_id::text, 12);
      update public.user_profiles set username = new_username, updated_at = now() where user_id = other_admin_id;
    end if;

    update auth.users
      set encrypted_password = password_hash,
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          banned_until = null,
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||
            '{"username":"admin","full_name":"Super Admin","role_key":"super_admin"}'::jsonb,
          updated_at = now()
      where id = target_id;
  end if;

  insert into public.user_profiles (user_id, username, role_key, display_name)
  values (target_id, 'admin', 'super_admin', 'Super Admin')
  on conflict (user_id) do update
    set username = excluded.username,
        role_key = excluded.role_key,
        display_name = excluded.display_name,
        updated_at = now();

  raise notice 'Super Admin credentials restored for username admin (Auth email: %)', target_email;
end;
$$;

-- Verify the account was repaired in this Supabase project.
select p.username, p.role_key, u.email,
       (u.email_confirmed_at is not null) as email_confirmed,
       coalesce(u.banned_until > now(), false) as is_banned
from public.user_profiles p
join auth.users u on u.id = p.user_id
where lower(p.username) = 'admin';
