-- =====================================================================
-- GDSR website migration
-- Safe to run more than once. Adds:
--   1. Public read access so visitors can browse without an account
--   2. Row-level security: users edit only their own rows, admins edit everything
--   3. Two public stats views (vote averages and favourite-part counts, no user IDs)
--   4. A playlists table
--   5. An "audio" storage bucket for song files
-- Relies on the existing public.has_role(_user_id uuid, _role app_role) function.
-- =====================================================================

grant usage on schema public to anon, authenticated;

-- ---------- helper: (re)create a policy without "already exists" errors ----------
create or replace function pg_temp.policy(_name text, _table text, _sql text) returns void
language plpgsql as $$
begin
  execute format('drop policy if exists %I on %s', _name, _table);
  execute format('create policy %I on %s %s', _name, _table, _sql);
end $$;

-- ---------- 1. Public catalogue: anyone can read ----------
grant select on public.levels, public.songs, public.song_ids to anon, authenticated;
alter table public.levels   enable row level security;
alter table public.songs    enable row level security;
alter table public.song_ids enable row level security;
select pg_temp.policy('gdsr_public_read', 'public.levels',   'for select to anon, authenticated using (true)');
select pg_temp.policy('gdsr_public_read', 'public.songs',    'for select to anon, authenticated using (true)');
select pg_temp.policy('gdsr_public_read', 'public.song_ids', 'for select to anon, authenticated using (true)');

-- ---------- 2a. Admins can do everything on every table ----------
do $$
declare t text;
begin
  foreach t in array array['levels','songs','song_ids','votes','favourite_parts',
                           'level_requests','song_requests','profiles','user_roles'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    perform pg_temp.policy('gdsr_admin_all', 'public.' || t,
      'for all to authenticated using (public.has_role(auth.uid(), ''admin'')) with check (public.has_role(auth.uid(), ''admin''))');
  end loop;
end $$;

-- ---------- 2b. Signed-in users manage only their own rows ----------
-- votes: one per user per song, 0-100
select pg_temp.policy('gdsr_own_select', 'public.votes', 'for select to authenticated using (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_insert', 'public.votes', 'for insert to authenticated with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_update', 'public.votes', 'for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_delete', 'public.votes', 'for delete to authenticated using (user_id = auth.uid())');

-- favourite parts: one per user per song
select pg_temp.policy('gdsr_own_select', 'public.favourite_parts', 'for select to authenticated using (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_insert', 'public.favourite_parts', 'for insert to authenticated with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_update', 'public.favourite_parts', 'for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_delete', 'public.favourite_parts', 'for delete to authenticated using (user_id = auth.uid())');

-- requests: users submit (always as pending) and see their own; only admins review
select pg_temp.policy('gdsr_own_select', 'public.level_requests', 'for select to authenticated using (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_insert', 'public.level_requests', 'for insert to authenticated with check (user_id = auth.uid() and status = ''pending'' and reviewed_by is null)');
select pg_temp.policy('gdsr_own_select', 'public.song_requests',  'for select to authenticated using (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_insert', 'public.song_requests',  'for insert to authenticated with check (user_id = auth.uid() and status = ''pending'' and reviewed_by is null)');

-- profiles: users read and edit their own (emails are never public)
select pg_temp.policy('gdsr_own_select', 'public.profiles', 'for select to authenticated using (id = auth.uid())');
select pg_temp.policy('gdsr_own_update', 'public.profiles', 'for update to authenticated using (id = auth.uid()) with check (id = auth.uid())');

-- roles: users can read their own role, never change it
select pg_temp.policy('gdsr_own_select', 'public.user_roles', 'for select to authenticated using (user_id = auth.uid())');

-- data rules (skipped if existing data breaks them)
do $$ begin
  alter table public.votes add constraint votes_one_per_user unique (user_id, song);
exception when others then raise notice 'votes_one_per_user skipped: %', sqlerrm; end $$;
do $$ begin
  alter table public.votes add constraint votes_score_range check (score >= 0 and score <= 100);
exception when others then raise notice 'votes_score_range skipped: %', sqlerrm; end $$;
do $$ begin
  alter table public.favourite_parts add constraint favourite_one_per_user unique (user_id, song);
exception when others then raise notice 'favourite_one_per_user skipped: %', sqlerrm; end $$;

-- ---------- 3. Public stats (aggregates only, no user IDs) ----------
create or replace view public.song_vote_stats as
  select song, count(*)::int as votes, round(avg(score)::numeric, 2) as avg_score
  from public.votes group by song;

create or replace view public.favourite_counts as
  select song, time, count(*)::int as quantity
  from public.favourite_parts group by song, time;

grant select on public.song_vote_stats, public.favourite_counts to anon, authenticated;

-- ---------- 4. Playlists (songs stored as an ordered list of song IDs) ----------
create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  songs       uuid[] not null default '{}',
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.playlists enable row level security;
grant select on public.playlists to anon;
grant select, insert, update, delete on public.playlists to authenticated;
select pg_temp.policy('gdsr_read',       'public.playlists', 'for select to anon, authenticated using (is_public or user_id = auth.uid())');
select pg_temp.policy('gdsr_own_insert', 'public.playlists', 'for insert to authenticated with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_update', 'public.playlists', 'for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())');
select pg_temp.policy('gdsr_own_delete', 'public.playlists', 'for delete to authenticated using (user_id = auth.uid())');
select pg_temp.policy('gdsr_admin_all',  'public.playlists', 'for all to authenticated using (public.has_role(auth.uid(), ''admin'')) with check (public.has_role(auth.uid(), ''admin''))');

-- ---------- 5. Audio storage ----------
insert into storage.buckets (id, name, public)
values ('audio', 'audio', true)
on conflict (id) do update set public = true;

select pg_temp.policy('gdsr_audio_read',  'storage.objects', 'for select to anon, authenticated using (bucket_id = ''audio'')');
select pg_temp.policy('gdsr_audio_admin', 'storage.objects', 'for all to authenticated using (bucket_id = ''audio'' and public.has_role(auth.uid(), ''admin'')) with check (bucket_id = ''audio'' and public.has_role(auth.uid(), ''admin''))');
-- users may upload only into audio/requests/<their user id>/...
select pg_temp.policy('gdsr_audio_user_upload', 'storage.objects', 'for insert to authenticated with check (bucket_id = ''audio'' and (storage.foldername(name))[1] = ''requests'' and (storage.foldername(name))[2] = auth.uid()::text)');
