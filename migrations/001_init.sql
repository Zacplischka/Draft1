-- Walking skeleton: ALL tables per docs/SCHEMA.md. Later tickets add behaviour, never tables.

create extension if not exists pgcrypto;

create type workflow_enum as enum ('crowdsourced', 'preset');
create type phase_enum as enum ('lobby', 'curation', 'voting', 'results');
create type department_enum as enum ('Product', 'Engineering', 'Sales', 'Marketing', 'Operations', 'Other');
create type role_enum as enum ('Individual Contributor', 'Team Lead', 'Manager', 'Director', 'Executive');
create type tenure_enum as enum ('<1 year', '1–2 years', '2–5 years', '5–10 years', '10+ years');

create table profiles (
  id            uuid primary key,
  display_name  text not null,
  department    department_enum not null,
  role          role_enum not null,
  tenure        tenure_enum not null
);

-- FK to auth.users only where the Supabase auth schema exists (plain-Postgres test DBs lack it).
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    alter table profiles
      add constraint profiles_id_fkey foreign key (id) references auth.users (id);
  end if;
end $$;

create table sessions (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references profiles (id),
  problem           text not null,
  workflow          workflow_enum not null,
  phase             phase_enum not null default 'lobby',
  cap               int not null default 8 check (cap between 2 and 100),
  host_participates boolean not null,
  join_code         char(6) not null,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz
);

-- Join codes recycle: unique only among sessions not yet in results.
create unique index sessions_join_code_active on sessions (join_code) where phase <> 'results';

create table memberships (
  session_id      uuid not null references sessions (id),
  user_id         uuid not null references profiles (id),
  submitted       boolean not null default false,
  -- immutable snapshot of the member's own submission; source of me.submissionText
  -- (survives curation hard-deletes; solutions rows are the deck's working copy)
  submission_text text,
  voted           boolean not null default false,
  joined_at       timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table solutions (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id),
  text         text not null,
  combined     boolean not null default false,
  created_at   timestamptz not null default now(), -- deck order = insertion order (contract)
  -- NULL for combined rows AND all preset-workflow (host-added) rows
  submitted_by uuid references profiles (id),
  -- one-per-participant; bites only crowdsourced originals (NULLs exempt)
  unique (session_id, submitted_by)
);

create table ballots (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions (id),
  user_id      uuid not null references profiles (id), -- linked, never displayed (ADR-0002)
  -- demographics snapshot at submission; reports read THESE
  department   department_enum not null,
  role         role_enum not null,
  tenure       tenure_enum not null,
  submitted_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table ballot_scores (
  ballot_id   uuid not null references ballots (id),
  solution_id uuid not null references solutions (id),
  score       int not null check (score between 0 and 100),
  primary key (ballot_id, solution_id)
);
