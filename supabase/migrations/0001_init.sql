-- boxyy — initial schema (Phase 1)
-- Apply this in: Supabase Dashboard → SQL Editor → New query → paste → Run.
--
-- This migration creates:
--   - public.users          (profile linked 1:1 to auth.users)
--   - public.boxes          (owned boxes; one row per (x,y))
--   - public.box_activity   (counters used for the ranked feed)
--   - public.box_coord_cursor (singleton cursor for spiral coord assignment)
--   - SECURITY DEFINER functions: claim_next_box, set_box_content,
--     box_heartbeat, set_username, nth_spiral_coord
--   - A trigger that auto-creates a public.users row when a Supabase auth user
--     signs up (e.g. first Google sign-in).
--   - Row Level Security policies. The client cannot bypass these.
--
-- Safe to re-run: every CREATE uses IF NOT EXISTS / OR REPLACE / ON CONFLICT.

-- ────────────────────────────────────────────────────────────────────────────
-- Extensions
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists "citext";
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
-- Tables
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      citext unique,
  email         citext,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.boxes (
  x             integer not null,
  y             integer not null,
  owner_id      uuid not null references public.users(id) on delete cascade,
  content_kind  text,
  content_data  jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (x, y)
);
create index if not exists boxes_owner_idx on public.boxes (owner_id);

create table if not exists public.box_activity (
  box_x          integer not null,
  box_y          integer not null,
  live_views     integer not null default 0,
  hourly_views   integer not null default 0,
  daily_views    integer not null default 0,
  likes_count    integer not null default 0,
  last_active_at timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (box_x, box_y),
  foreign key (box_x, box_y) references public.boxes(x, y) on delete cascade
);

create table if not exists public.box_coord_cursor (
  id      integer primary key default 1,
  next_n  bigint not null default 0,
  constraint singleton check (id = 1)
);
insert into public.box_coord_cursor (id, next_n) values (1, 0)
  on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- Auto-create profile row when a Supabase auth user signs up
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar_url',
             new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────────
-- Spiral coordinate function (pure)
-- nth_spiral_coord(0) → (0,0); 1 → (1,0); 2 → (1,1); 3 → (0,1); ...
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.nth_spiral_coord(n bigint)
returns table(x integer, y integer)
language plpgsql
immutable
as $$
declare
  k          bigint := 1;
  start_n    bigint;
  side_len   bigint;
  off        bigint;
  side       bigint;
  pos        bigint;
begin
  if n = 0 then
    return query select 0, 0;
    return;
  end if;
  while 1 + 4 * k * (k - 1) + 8 * k <= n loop
    k := k + 1;
  end loop;
  start_n  := 1 + 4 * k * (k - 1);
  side_len := 2 * k;
  off      := n - start_n;
  side     := off / side_len;
  pos      := off % side_len;
  if side = 0 then
    return query select k::int, (-k + 1 + pos)::int;
  elsif side = 1 then
    return query select (k - 1 - pos)::int, k::int;
  elsif side = 2 then
    return query select (-k)::int, (k - 1 - pos)::int;
  else
    return query select (-k + 1 + pos)::int, (-k)::int;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Atomic claim-next-box: locks cursor row, finds next free coord, inserts box.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_next_box()
returns table(x integer, y integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_n       bigint;
  v_x       integer;
  v_y       integer;
  v_taken   boolean;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  -- Make sure the profile row exists (it normally does via the trigger)
  insert into public.users (id) values (v_user_id) on conflict (id) do nothing;

  -- Lock the cursor singleton row
  select next_n into v_n from public.box_coord_cursor where id = 1 for update;

  loop
    select c.x, c.y into v_x, v_y from public.nth_spiral_coord(v_n) c;
    select exists(select 1 from public.boxes b where b.x = v_x and b.y = v_y) into v_taken;
    exit when not v_taken;
    v_n := v_n + 1;
  end loop;

  insert into public.boxes (x, y, owner_id) values (v_x, v_y, v_user_id);
  insert into public.box_activity (box_x, box_y, last_active_at)
    values (v_x, v_y, now())
    on conflict (box_x, box_y) do nothing;

  update public.box_coord_cursor set next_n = v_n + 1 where id = 1;

  return query select v_x, v_y;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Owner-only content update (validated)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_box_content(p_x integer, p_y integer, p_kind text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('youtube') then
    raise exception 'unsupported content kind: %', p_kind;
  end if;
  update public.boxes
     set content_kind = p_kind,
         content_data = p_data,
         updated_at   = now()
   where x = p_x and y = p_y and owner_id = v_user_id;
  if not found then
    raise exception 'not owner or box does not exist';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Heartbeat: bumps activity counters. Called every 10s by the active viewer.
-- A real implementation will buffer this in Redis; Phase 1 writes straight
-- to Postgres because the volume is tiny.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.box_heartbeat(p_x integer, p_y integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.box_activity (box_x, box_y, live_views, hourly_views, daily_views, last_active_at)
  values (p_x, p_y, 1, 1, 1, now())
  on conflict (box_x, box_y) do update
    set live_views     = 1,
        hourly_views   = box_activity.hourly_views + 1,
        daily_views    = box_activity.daily_views + 1,
        last_active_at = now(),
        updated_at     = now();
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Username claim / change
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  v_clean := trim(p_username);
  if v_clean !~ '^[a-zA-Z0-9_]{3,20}$' then
    raise exception 'username must be 3-20 chars: letters, numbers, underscore';
  end if;
  update public.users set username = v_clean where id = v_user_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- The ranked feed view. Computes time-decayed score on the fly.
-- Phase 1 reads this directly; Phase 8b will replace it with a materialized
-- pre-rendered top-500 in Redis driven by a worker.
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.box_feed as
select
  b.x,
  b.y,
  b.owner_id,
  u.username     as owner_username,
  u.avatar_url   as owner_avatar,
  b.content_kind,
  b.content_data,
  b.updated_at,
  coalesce(a.live_views, 0)   as live_views,
  coalesce(a.hourly_views, 0) as hourly_views,
  coalesce(a.daily_views, 0)  as daily_views,
  coalesce(a.likes_count, 0)  as likes_count,
  (
    (coalesce(a.live_views, 0) * 50
     + coalesce(a.hourly_views, 0) * 5
     + coalesce(a.daily_views, 0)
     + coalesce(a.likes_count, 0) * 10)::double precision
    / power(extract(epoch from (now() - coalesce(a.last_active_at, b.updated_at))) / 3600.0 + 2.0, 1.5)
  ) as rank_score
from public.boxes b
join public.users u on u.id = b.owner_id
left join public.box_activity a on a.box_x = b.x and a.box_y = b.y;

-- ────────────────────────────────────────────────────────────────────────────
-- Row-Level Security
-- ────────────────────────────────────────────────────────────────────────────
alter table public.users            enable row level security;
alter table public.boxes            enable row level security;
alter table public.box_activity     enable row level security;
alter table public.box_coord_cursor enable row level security;

-- users
drop policy if exists "users public read"  on public.users;
drop policy if exists "users self update"  on public.users;
create policy "users public read"  on public.users for select using (true);
create policy "users self update"  on public.users for update using (id = auth.uid());

-- boxes
drop policy if exists "boxes public read"  on public.boxes;
drop policy if exists "boxes owner update" on public.boxes;
create policy "boxes public read"  on public.boxes for select using (true);
create policy "boxes owner update" on public.boxes for update using (owner_id = auth.uid());
-- No insert policy → boxes can only be created via claim_next_box() (SECURITY DEFINER).

-- box_activity
drop policy if exists "activity public read" on public.box_activity;
create policy "activity public read" on public.box_activity for select using (true);
-- No write policies → only via box_heartbeat() (SECURITY DEFINER).

-- box_coord_cursor: no policies = no client access. Only SECURITY DEFINER funcs.

-- View permissions
grant select on public.box_feed to anon, authenticated;

-- Function permissions
grant execute on function public.claim_next_box()                                    to authenticated;
grant execute on function public.set_box_content(integer, integer, text, jsonb)      to authenticated;
grant execute on function public.box_heartbeat(integer, integer)                     to anon, authenticated;
grant execute on function public.set_username(text)                                  to authenticated;
grant execute on function public.nth_spiral_coord(bigint)                            to anon, authenticated;
