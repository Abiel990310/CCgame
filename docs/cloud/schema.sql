-- CCgame accounts, cloud saves, friends and shared worlds.
--
-- Paste this whole file into the Supabase SQL editor (Project > SQL Editor >
-- New query) and run it once. Running it again is safe: every statement either
-- checks first or replaces what it defined last time.
--
-- The game never touches a table directly. Every read and write goes through
-- one of the functions below, which run as the table owner and check
-- `auth.uid()` themselves, and the tables grant nothing to the browser roles.
-- That keeps the whole security story in one file you can read top to bottom:
-- if a function does not allow it, nobody can do it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
-- Names are what friends type to find each other, so two may not differ only
-- by case.
create unique index if not exists profiles_name_key on public.profiles (lower(name));

create table if not exists public.friend_requests (
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists friend_requests_to on public.friend_requests (to_id);

-- Stored in both directions, so "my friends" is one index lookup.
create table if not exists public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  since timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.worlds (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  -- 'private': only the owner. 'friends': the owner's friends may join while
  -- someone is playing it.
  access text not null default 'private' check (access in ('private', 'friends')),
  -- What the menu card shows (night, level, play time), so a list never has to
  -- download an island.
  summary jsonb not null default '{}'::jsonb,
  rev integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The one browser playing this world right now. `lease` is a random id that
  -- browser made when it opened the world; only it may save, and it keeps
  -- `host_seen` fresh while it plays. A lease older than 45 seconds is dead.
  lease uuid,
  host_seen timestamptz,
  -- The co-op room code friends join with, while the host has one open.
  room text
);
create index if not exists worlds_owner on public.worlds (owner);

create table if not exists public.world_data (
  world_id uuid primary key references public.worlds (id) on delete cascade,
  data text not null
);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.worlds enable row level security;
alter table public.world_data enable row level security;

-- No policies and no grants: the browser reaches these only through the
-- functions below.
revoke all on public.profiles, public.friend_requests, public.friendships, public.worlds, public.world_data
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

-- A big, long-played island saves to a few hundred kilobytes. The cap is there
-- so nobody can fill the free database with one row.
create or replace function public.ccg_max_save_bytes() returns integer
language sql immutable as $$ select 4000000 $$;

create or replace function public.ccg_max_worlds() returns integer
language sql immutable as $$ select 30 $$;

create or replace function public.ccg_lease_seconds() returns integer
language sql immutable as $$ select 45 $$;

create or replace function public.ccg_valid_name(p_name text) returns boolean
language sql immutable as $$
  select p_name ~ '^[A-Za-z0-9_]{3,16}$'
$$;

create or replace function public.ccg_me() returns uuid
language plpgsql stable as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  return me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- Every new account gets a profile under the name it signed up with. If that
-- name was taken between the check and the sign-up, digits are added rather
-- than failing the whole sign-up; the player can rename afterwards.
create or replace function public.ccg_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  wanted text := coalesce(new.raw_user_meta_data ->> 'name', '');
  candidate text;
  n integer := 0;
begin
  if not public.ccg_valid_name(wanted) then
    wanted := 'Islander';
  end if;
  candidate := wanted;
  while exists (select 1 from public.profiles where lower(name) = lower(candidate)) loop
    n := n + 1;
    candidate := left(wanted, 12) || (floor(random() * 9000) + 1000)::int;
    if n > 20 then
      candidate := 'Islander' || substr(replace(new.id::text, '-', ''), 1, 8);
      exit;
    end if;
  end loop;
  insert into public.profiles (id, name) values (new.id, candidate);
  return new;
end;
$$;

drop trigger if exists ccg_on_auth_user_created on auth.users;
create trigger ccg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.ccg_new_user();

create or replace function public.name_available(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.ccg_valid_name(p_name)
     and not exists (select 1 from public.profiles where lower(name) = lower(p_name))
$$;

create or replace function public.my_profile() returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  return (select json_build_object('id', id, 'name', name) from public.profiles where id = me);
end;
$$;

create or replace function public.set_name(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  if not public.ccg_valid_name(p_name) then
    return 'invalid';
  end if;
  if exists (select 1 from public.profiles where lower(name) = lower(p_name) and id <> me) then
    return 'taken';
  end if;
  update public.profiles set name = p_name where id = me;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------

create or replace function public.ccg_befriend(a uuid, b uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.friend_requests where (from_id = a and to_id = b) or (from_id = b and to_id = a);
  insert into public.friendships (user_id, friend_id) values (a, b), (b, a) on conflict do nothing;
$$;

-- 'sent', 'friends' (they had already asked you, so you are friends now),
-- 'already', 'self' or 'not_found'.
create or replace function public.send_friend_request(p_name text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
  them uuid;
begin
  select id into them from public.profiles where lower(name) = lower(trim(p_name));
  if them is null then
    return 'not_found';
  end if;
  if them = me then
    return 'self';
  end if;
  if exists (select 1 from public.friendships where user_id = me and friend_id = them) then
    return 'already';
  end if;
  if exists (select 1 from public.friend_requests where from_id = them and to_id = me) then
    perform public.ccg_befriend(me, them);
    return 'friends';
  end if;
  -- A cap on unanswered requests keeps one account from flooding the table.
  if (select count(*) from public.friend_requests where from_id = me) >= 100 then
    return 'too_many';
  end if;
  insert into public.friend_requests (from_id, to_id) values (me, them) on conflict do nothing;
  return 'sent';
end;
$$;

create or replace function public.answer_friend_request(p_from uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  if not exists (select 1 from public.friend_requests where from_id = p_from and to_id = me) then
    return;
  end if;
  if p_accept then
    perform public.ccg_befriend(me, p_from);
  else
    delete from public.friend_requests where from_id = p_from and to_id = me;
  end if;
end;
$$;

create or replace function public.cancel_friend_request(p_to uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.friend_requests where from_id = public.ccg_me() and to_id = p_to;
end;
$$;

create or replace function public.remove_friend(p_friend uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  delete from public.friendships
   where (user_id = me and friend_id = p_friend) or (user_id = p_friend and friend_id = me);
end;
$$;

-- Everything the friends screen shows, in one call. `playing` is the name of
-- the world a friend is in right now, when it is one you may join.
create or replace function public.friends_overview() returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  return json_build_object(
    'friends', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name, 'since', f.since) order by lower(p.name))
        from public.friendships f join public.profiles p on p.id = f.friend_id
       where f.user_id = me), '[]'::json),
    'incoming', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name) order by r.created_at)
        from public.friend_requests r join public.profiles p on p.id = r.from_id
       where r.to_id = me), '[]'::json),
    'outgoing', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', p.name) order by r.created_at)
        from public.friend_requests r join public.profiles p on p.id = r.to_id
       where r.from_id = me), '[]'::json)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Worlds
-- ---------------------------------------------------------------------------

create or replace function public.ccg_live(w public.worlds) returns boolean
language sql stable as $$
  select w.lease is not null
     and w.host_seen is not null
     and w.host_seen > now() - make_interval(secs => public.ccg_lease_seconds())
$$;

-- Your worlds, then your friends' worlds that are open to friends. The room
-- code is only handed out while someone is actually playing.
create or replace function public.list_worlds() returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  return coalesce((
    select json_agg(json_build_object(
             'id', w.id,
             'owner', w.owner,
             'ownerName', p.name,
             'mine', w.owner = me,
             'name', w.name,
             'access', w.access,
             'summary', w.summary,
             'rev', w.rev,
             'updatedAt', extract(epoch from w.updated_at) * 1000,
             'live', public.ccg_live(w),
             'room', case when public.ccg_live(w) then w.room end
           ) order by (w.owner = me) desc, w.updated_at desc)
      from public.worlds w join public.profiles p on p.id = w.owner
     where w.owner = me
        or (w.access = 'friends'
            and exists (select 1 from public.friendships f where f.user_id = me and f.friend_id = w.owner))
  ), '[]'::json);
end;
$$;

create or replace function public.create_world(p_name text, p_access text, p_summary jsonb, p_data text)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
  made public.worlds;
begin
  if octet_length(p_data) > public.ccg_max_save_bytes() then
    raise exception 'This island is too big to keep in the cloud' using errcode = '54000';
  end if;
  if (select count(*) from public.worlds where owner = me) >= public.ccg_max_worlds() then
    raise exception 'You have as many islands in the cloud as an account can keep' using errcode = '54000';
  end if;
  insert into public.worlds (owner, name, access, summary)
  values (me, left(coalesce(nullif(trim(p_name), ''), 'Island'), 40),
          case when p_access = 'friends' then 'friends' else 'private' end,
          coalesce(p_summary, '{}'::jsonb))
  returning * into made;
  insert into public.world_data (world_id, data) values (made.id, p_data);
  return json_build_object('id', made.id, 'rev', made.rev);
end;
$$;

create or replace function public.update_world(p_id uuid, p_name text, p_access text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  update public.worlds
     set name = coalesce(left(nullif(trim(p_name), ''), 40), name),
         access = case when p_access in ('private', 'friends') then p_access else access end
   where id = p_id and owner = me;
end;
$$;

create or replace function public.delete_world(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.worlds where id = p_id and owner = public.ccg_me();
end;
$$;

create or replace function public.load_world(p_id uuid) returns json
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  return (
    select json_build_object('data', d.data, 'rev', w.rev, 'name', w.name, 'access', w.access)
      from public.worlds w join public.world_data d on d.world_id = w.id
     where w.id = p_id and w.owner = me
  );
end;
$$;

-- Start playing a world. Succeeds when nobody else is, or when `p_force` asks
-- to take it from another of your own devices, which then finds its lease
-- gone on its next heartbeat and stops. Otherwise says who has it.
create or replace function public.claim_world(p_id uuid, p_lease uuid, p_force boolean) returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
  w public.worlds;
begin
  select * into w from public.worlds where id = p_id and owner = me for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'missing');
  end if;
  if public.ccg_live(w) and w.lease <> p_lease and not p_force then
    return json_build_object('ok', false, 'reason', 'busy',
                             'seenSecondsAgo', extract(epoch from now() - w.host_seen));
  end if;
  update public.worlds set lease = p_lease, host_seen = now(), room = null where id = p_id;
  return json_build_object('ok', true, 'rev', w.rev, 'access', w.access);
end;
$$;

-- Still here. False means the lease was taken, and the caller must stop.
create or replace function public.beat_world(p_id uuid, p_lease uuid, p_room text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
begin
  update public.worlds
     set host_seen = now(), room = left(p_room, 16)
   where id = p_id and owner = me and lease = p_lease;
  return found;
end;
$$;

create or replace function public.release_world(p_id uuid, p_lease uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.worlds
     set lease = null, host_seen = null, room = null
   where id = p_id and owner = public.ccg_me() and lease = p_lease;
end;
$$;

-- Write the island. Only the browser holding the lease may, so two devices can
-- never take turns overwriting each other. Returns the new revision, or null
-- when the lease has gone to another device.
create or replace function public.save_world(p_id uuid, p_lease uuid, p_summary jsonb, p_data text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := public.ccg_me();
  next_rev integer;
begin
  if octet_length(p_data) > public.ccg_max_save_bytes() then
    raise exception 'This island is too big to keep in the cloud' using errcode = '54000';
  end if;
  update public.worlds
     set rev = rev + 1, summary = coalesce(p_summary, summary), updated_at = now(), host_seen = now()
   where id = p_id and owner = me and lease = p_lease
  returning rev into next_rev;
  if next_rev is null then
    return null;
  end if;
  update public.world_data set data = p_data where world_id = p_id;
  return next_rev;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.name_available(text) to anon, authenticated;
grant execute on function
  public.my_profile(),
  public.set_name(text),
  public.send_friend_request(text),
  public.answer_friend_request(uuid, boolean),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.friends_overview(),
  public.list_worlds(),
  public.create_world(text, text, jsonb, text),
  public.update_world(uuid, text, text),
  public.delete_world(uuid),
  public.load_world(uuid),
  public.claim_world(uuid, uuid, boolean),
  public.beat_world(uuid, uuid, text),
  public.release_world(uuid, uuid),
  public.save_world(uuid, uuid, jsonb, text)
  to authenticated;
