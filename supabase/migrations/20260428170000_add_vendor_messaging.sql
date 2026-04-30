-- ============================================================================
-- BUILDER/VENDOR BOOKING MESSAGING
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'message-attachments',
  'message-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.notifications
  add column if not exists type text,
  add column if not exists link text,
  add column if not exists metadata jsonb default '{}'::jsonb;

create table if not exists public.vendor_message_threads (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null unique references public.vendor_bookings(id) on delete cascade,
  vendor_id uuid not null references public.vendor_profiles(id) on delete cascade,
  builder_id uuid not null references public.builder_profiles(id) on delete cascade,
  subject text not null default 'Booking discussion',
  status text not null default 'active' check (status in ('active', 'archived', 'closed')),
  last_message_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.vendor_messages (
  id uuid primary key default uuid_generate_v4(),
  thread_id uuid not null references public.vendor_message_threads(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  sender_type text not null check (sender_type in ('builder', 'vendor')),
  message text not null default '' check (char_length(message) <= 10000),
  attachments jsonb default '[]'::jsonb,
  read_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.vendor_message_typing_indicators (
  thread_id uuid not null references public.vendor_message_threads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  sender_type text not null check (sender_type in ('builder', 'vendor')),
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_vendor_message_threads_builder
  on public.vendor_message_threads(builder_id, last_message_at desc);

create index if not exists idx_vendor_message_threads_vendor
  on public.vendor_message_threads(vendor_id, last_message_at desc);

create index if not exists idx_vendor_messages_thread_created
  on public.vendor_messages(thread_id, created_at);

create index if not exists idx_vendor_messages_thread_unread
  on public.vendor_messages(thread_id, read_at, sender_type);

create index if not exists idx_vendor_messages_search
  on public.vendor_messages using gin (to_tsvector('english', message));

drop trigger if exists update_vendor_message_threads_updated_at on public.vendor_message_threads;
create trigger update_vendor_message_threads_updated_at
  before update on public.vendor_message_threads
  for each row execute function public.update_updated_at_column();

alter table public.vendor_message_threads enable row level security;
alter table public.vendor_messages enable row level security;
alter table public.vendor_message_typing_indicators enable row level security;

drop policy if exists "Builders and vendors can view their message threads" on public.vendor_message_threads;
create policy "Builders and vendors can view their message threads"
  on public.vendor_message_threads for select
  using (
    builder_id in (select id from public.builder_profiles where user_id = auth.uid())
    or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  );

drop policy if exists "Builders and vendors can create booking message threads" on public.vendor_message_threads;
create policy "Builders and vendors can create booking message threads"
  on public.vendor_message_threads for insert
  with check (
    builder_id in (select id from public.builder_profiles where user_id = auth.uid())
    or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  );

drop policy if exists "Builders and vendors can update their message threads" on public.vendor_message_threads;
create policy "Builders and vendors can update their message threads"
  on public.vendor_message_threads for update
  using (
    builder_id in (select id from public.builder_profiles where user_id = auth.uid())
    or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  )
  with check (
    builder_id in (select id from public.builder_profiles where user_id = auth.uid())
    or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  );

drop policy if exists "Builders and vendors can view thread messages" on public.vendor_messages;
create policy "Builders and vendors can view thread messages"
  on public.vendor_messages for select
  using (
    thread_id in (
      select id
      from public.vendor_message_threads
      where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
         or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
    )
  );

drop policy if exists "Builders and vendors can send thread messages" on public.vendor_messages;
create policy "Builders and vendors can send thread messages"
  on public.vendor_messages for insert
  with check (
    sender_id = auth.uid()
    and (
      (sender_type = 'builder' and thread_id in (
        select id from public.vendor_message_threads
        where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
      ))
      or
      (sender_type = 'vendor' and thread_id in (
        select id from public.vendor_message_threads
        where vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
      ))
    )
  );

drop policy if exists "Builders and vendors can update read receipts" on public.vendor_messages;
create policy "Builders and vendors can update read receipts"
  on public.vendor_messages for update
  using (
    thread_id in (
      select id
      from public.vendor_message_threads
      where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
         or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
    )
  )
  with check (
    thread_id in (
      select id
      from public.vendor_message_threads
      where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
         or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
    )
  );

drop policy if exists "Builders and vendors can manage typing indicators" on public.vendor_message_typing_indicators;
create policy "Builders and vendors can manage typing indicators"
  on public.vendor_message_typing_indicators for all
  using (
    user_id = auth.uid()
    and thread_id in (
      select id
      from public.vendor_message_threads
      where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
         or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
    )
  )
  with check (
    user_id = auth.uid()
    and thread_id in (
      select id
      from public.vendor_message_threads
      where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
         or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
    )
  );

drop policy if exists "Thread participants can view message attachments" on storage.objects;
create policy "Thread participants can view message attachments"
on storage.objects
for select
using (
  bucket_id = 'message-attachments'
  and (storage.foldername(name))[1] in (
    select id::text
    from public.vendor_message_threads
    where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
       or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  )
);

drop policy if exists "Thread participants can upload message attachments" on storage.objects;
create policy "Thread participants can upload message attachments"
on storage.objects
for insert
with check (
  bucket_id = 'message-attachments'
  and (storage.foldername(name))[1] in (
    select id::text
    from public.vendor_message_threads
    where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
       or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  )
);

drop policy if exists "Thread participants can delete own message attachments" on storage.objects;
create policy "Thread participants can delete own message attachments"
on storage.objects
for delete
using (
  bucket_id = 'message-attachments'
  and owner = auth.uid()
  and (storage.foldername(name))[1] in (
    select id::text
    from public.vendor_message_threads
    where builder_id in (select id from public.builder_profiles where user_id = auth.uid())
       or vendor_id in (select id from public.vendor_profiles where user_id = auth.uid())
  )
);
