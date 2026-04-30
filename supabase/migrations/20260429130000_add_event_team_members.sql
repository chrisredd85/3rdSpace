create table if not exists event_team_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  email text not null,
  role text not null check (role in ('organizer', 'coordinator', 'vendor_contact')),
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined')),
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(event_id, email)
);
alter table event_team_members enable row level security;
create policy "Builders can manage their event team" on event_team_members
  for all using (
    exists (
      select 1
      from events
      join builder_profiles on builder_profiles.id = events.builder_id
      where events.id = event_team_members.event_id
        and builder_profiles.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from events
      join builder_profiles on builder_profiles.id = events.builder_id
      where events.id = event_team_members.event_id
        and builder_profiles.user_id = auth.uid()
    )
  );
