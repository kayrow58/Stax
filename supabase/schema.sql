-- ============================================================
-- Scratch & Save — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

-- A couple (or any pair of savers) sharing one board.
create table if not exists public.couples (
  id          uuid primary key default gen_random_uuid(),
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

-- Each person belongs to exactly one couple.
create table if not exists public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  couple_id    uuid not null references public.couples (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now()
);
create index if not exists members_couple_idx on public.members (couple_id);

-- A savings chart. Only one is active per couple at a time.
create table if not exists public.charts (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples (id) on delete cascade,
  name         text not null default 'Our savings chart' check (char_length(name) between 1 and 60),
  goal         integer not null,          -- exact total of every square
  step         integer not null,          -- dollars between squares
  square_count integer not null,
  months       integer not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists charts_one_active on public.charts (couple_id) where is_active;

-- The squares on a chart. "position" is where the square sits in the grid.
create table if not exists public.squares (
  id           bigint generated always as identity primary key,
  chart_id     uuid not null references public.charts (id) on delete cascade,
  position     integer not null,
  amount       integer not null,
  scratched_at timestamptz,
  scratched_by uuid references auth.users (id) on delete set null,
  unique (chart_id, position)
);
create index if not exists squares_chart_idx on public.squares (chart_id);

-- Each person's pay schedule, used for payday reminders.
create table if not exists public.pay_schedules (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  kind             text not null check (kind in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  anchor_date      date,                   -- a real payday (not needed for 1st & 15th)
  remind_hour      smallint not null default 9 check (remind_hour between 0 and 23),
  timezone         text not null default 'America/Chicago',
  email_backup     boolean not null default false,
  last_notified_on date,
  updated_at       timestamptz not null default now()
);

-- Phones/browsers that agreed to receive notifications.
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_user_idx on public.push_subscriptions (user_id);

-- ---------- Helper ----------

create or replace function public.my_couple_id()
returns uuid
language sql stable security definer set search_path = public
as $$ select couple_id from public.members where user_id = auth.uid() $$;

-- ---------- Row-level security (who can see what) ----------

alter table public.couples            enable row level security;
alter table public.members            enable row level security;
alter table public.charts             enable row level security;
alter table public.squares            enable row level security;
alter table public.pay_schedules      enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "see my couple" on public.couples;
create policy "see my couple" on public.couples
  for select to authenticated using (id = public.my_couple_id());

drop policy if exists "see my couple's members" on public.members;
create policy "see my couple's members" on public.members
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "rename myself" on public.members;
create policy "rename myself" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "see my couple's charts" on public.charts;
create policy "see my couple's charts" on public.charts
  for select to authenticated using (couple_id = public.my_couple_id());

drop policy if exists "see my couple's squares" on public.squares;
create policy "see my couple's squares" on public.squares
  for select to authenticated using (
    exists (select 1 from public.charts c where c.id = chart_id and c.couple_id = public.my_couple_id())
  );

drop policy if exists "manage my pay schedule" on public.pay_schedules;
create policy "manage my pay schedule" on public.pay_schedules
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "manage my push subscriptions" on public.push_subscriptions;
create policy "manage my push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Actions the app calls ----------

-- Start a new couple with me as the first member. Returns the couple id.
create or replace function public.create_couple(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then
    return (select couple_id from members where user_id = auth.uid());
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from couples where invite_code = v_code);
  end loop;
  insert into couples (invite_code) values (v_code) returning id into v_id;
  insert into members (user_id, couple_id, display_name) values (auth.uid(), v_id, trim(p_name));
  return v_id;
end $$;

-- Join a partner's couple with their invite code. Returns the couple id.
create or replace function public.join_couple(p_code text, p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_couple uuid;
  v_mine uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select id into v_couple from couples
    where invite_code = upper(replace(replace(trim(p_code), '-', ''), ' ', ''));
  if v_couple is null then raise exception 'That invite code didn''t match a chart. Double-check it with your partner.'; end if;
  select couple_id into v_mine from members where user_id = auth.uid();
  if v_mine = v_couple then return v_couple; end if;
  if v_mine is not null then
    -- Leaving a solo couple (nobody else in it) to join a partner is fine.
    if (select count(*) from members where couple_id = v_mine) > 1 then
      raise exception 'You''re already sharing a chart with someone.';
    end if;
    delete from couples where id = v_mine;
  end if;
  if (select count(*) from members where couple_id = v_couple) >= 2 then
    raise exception 'That chart already has two people on it.';
  end if;
  insert into members (user_id, couple_id, display_name) values (auth.uid(), v_couple, trim(p_name));
  return v_couple;
end $$;

-- Generate a chart from a goal. Squares go $step, $2*step ... $n*step, shuffled.
create or replace function public.create_chart(p_name text, p_goal integer, p_months integer)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_couple uuid := public.my_couple_id();
  v_n integer;
  v_step integer;
  v_id uuid;
begin
  if v_couple is null then raise exception 'Set up your couple first.'; end if;
  if p_goal < 55 or p_goal > 10000000 then raise exception 'Pick a goal between $55 and $10,000,000.'; end if;
  if p_months < 1 or p_months > 120 then raise exception 'Pick a timeframe between 1 and 120 months.'; end if;
  v_n := case when p_goal >= 5050 then 100
              else greatest(10, floor((sqrt(8 * p_goal + 1) - 1) / 2)::int) end;
  v_step := greatest(1, round(p_goal::numeric / (v_n * (v_n + 1) / 2))::int);

  update charts set is_active = false where couple_id = v_couple and is_active;
  insert into charts (couple_id, name, goal, step, square_count, months)
    values (v_couple, coalesce(nullif(trim(p_name), ''), 'Our savings chart'),
            v_step * v_n * (v_n + 1) / 2, v_step, v_n, p_months)
    returning id into v_id;
  insert into squares (chart_id, position, amount)
    select v_id, (row_number() over (order by random()))::int - 1, g * v_step
    from generate_series(1, v_n) g;
  return v_id;
end $$;

-- Mark a square scratched. Fails if your partner got there first.
create or replace function public.scratch_square(p_square bigint)
returns public.squares
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.squares;
begin
  update squares s set scratched_at = now(), scratched_by = auth.uid()
    from charts c
    where s.id = p_square and c.id = s.chart_id and c.is_active
      and c.couple_id = public.my_couple_id() and s.scratched_at is null
    returning s.* into v_row;
  if v_row.id is null then raise exception 'That square was already scratched.'; end if;
  if not exists (select 1 from squares where chart_id = v_row.chart_id and scratched_at is null) then
    update charts set completed_at = now() where id = v_row.chart_id;
  end if;
  return v_row;
end $$;

-- Undo your own scratch within 10 minutes.
create or replace function public.undo_scratch(p_square bigint)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_chart uuid;
begin
  update squares s set scratched_at = null, scratched_by = null
    from charts c
    where s.id = p_square and c.id = s.chart_id and c.couple_id = public.my_couple_id()
      and s.scratched_by = auth.uid() and s.scratched_at > now() - interval '10 minutes'
    returning s.chart_id into v_chart;
  if v_chart is null then raise exception 'That scratch can''t be undone anymore.'; end if;
  update charts set completed_at = null where id = v_chart;
end $$;

-- Save this device for notifications (moves it over if someone else used it before).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

revoke all on function public.create_couple(text)                      from public, anon;
revoke all on function public.join_couple(text, text)                  from public, anon;
revoke all on function public.create_chart(text, integer, integer)     from public, anon;
revoke all on function public.scratch_square(bigint)                   from public, anon;
revoke all on function public.undo_scratch(bigint)                     from public, anon;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.create_couple(text)                      to authenticated;
grant execute on function public.join_couple(text, text)                  to authenticated;
grant execute on function public.create_chart(text, integer, integer)     to authenticated;
grant execute on function public.scratch_square(bigint)                   to authenticated;
grant execute on function public.undo_scratch(bigint)                     to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- ---------- Live updates between partners ----------

do $$
begin
  begin alter publication supabase_realtime add table public.squares; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.charts;  exception when duplicate_object then null; end;
end $$;
