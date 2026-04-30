create table if not exists event_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  due_date date null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table event_tasks enable row level security;
create policy "Builders can manage their event tasks" on event_tasks
  for all using (
    exists (
      select 1
      from events
      join builder_profiles on builder_profiles.id = events.builder_id
      where events.id = event_tasks.event_id
        and builder_profiles.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from events
      join builder_profiles on builder_profiles.id = events.builder_id
      where events.id = event_tasks.event_id
        and builder_profiles.user_id = auth.uid()
    )
  );
