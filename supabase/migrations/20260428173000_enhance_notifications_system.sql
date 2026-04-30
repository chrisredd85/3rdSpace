-- ============================================================================
-- NOTIFICATION SYSTEM ENHANCEMENTS
-- ============================================================================

alter table public.notifications
  add column if not exists type text,
  add column if not exists link text,
  add column if not exists action_url text,
  add column if not exists related_id uuid,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists group_key text;

update public.notifications
set
  type = coalesce(type, notification_type),
  link = coalesce(link, link_url, action_url),
  action_url = coalesce(action_url, link, link_url),
  metadata = coalesce(metadata, '{}'::jsonb),
  group_key = coalesce(group_key, user_id::text || ':' || coalesce(type, notification_type, 'notification') || ':' || coalesce(related_id::text, id::text));

alter table public.notifications
  drop constraint if exists valid_notification_type;

alter table public.notifications
  add constraint valid_notification_type
    check (
      coalesce(type, notification_type) in (
        'new_booking_request',
        'booking_confirmed',
        'booking_declined',
        'booking_approved',
        'booking_rejected',
        'booking_cancelled',
        'new_booking',
        'new_message',
        'payment_received',
        'invoice_sent',
        'payment_due',
        'review_posted',
        'review_received',
        'review_request',
        'reminder',
        'cancellation'
      )
    );

create index if not exists idx_notifications_user_read_created
  on public.notifications(user_id, read_at, is_read, created_at desc);

create index if not exists idx_notifications_group_unread
  on public.notifications(user_id, group_key)
  where read_at is null;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled boolean not null default false,
  sound_enabled boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "Users can view their notification preferences" on public.notification_preferences;
create policy "Users can view their notification preferences"
  on public.notification_preferences for select
  using (user_id = auth.uid());

drop policy if exists "Users can insert their notification preferences" on public.notification_preferences;
create policy "Users can insert their notification preferences"
  on public.notification_preferences for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can update their notification preferences" on public.notification_preferences;
create policy "Users can update their notification preferences"
  on public.notification_preferences for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists update_notification_preferences_updated_at on public.notification_preferences;
create trigger update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.update_updated_at_column();

create or replace function public.insert_grouped_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_related_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_group_key text default null
)
returns uuid
language plpgsql
security definer
as $$
declare
  notification_id uuid;
  resolved_group_key text;
  existing_count integer;
begin
  resolved_group_key := coalesce(
    p_group_key,
    p_user_id::text || ':' || p_type || ':' || coalesce(p_related_id::text, md5(p_message))
  );

  select id, coalesce((metadata->>'count')::integer, 1)
  into notification_id, existing_count
  from public.notifications
  where user_id = p_user_id
    and group_key = resolved_group_key
    and read_at is null
  order by created_at desc
  limit 1;

  if notification_id is not null then
    update public.notifications
    set
      title = p_title,
      message = p_message,
      link = p_link,
      link_url = p_link,
      action_url = p_link,
      related_id = p_related_id,
      metadata = coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('count', existing_count + 1),
      is_read = false,
      created_at = now()
    where id = notification_id;

    return notification_id;
  end if;

  insert into public.notifications (
    user_id,
    type,
    notification_type,
    title,
    message,
    link,
    link_url,
    action_url,
    related_id,
    metadata,
    group_key,
    is_read,
    read_at
  )
  values (
    p_user_id,
    p_type,
    p_type,
    p_title,
    p_message,
    p_link,
    p_link,
    p_link,
    p_related_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('count', 1),
    resolved_group_key,
    false,
    null
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

grant execute on function public.insert_grouped_notification(uuid, text, text, text, text, uuid, jsonb, text) to authenticated;
grant execute on function public.insert_grouped_notification(uuid, text, text, text, text, uuid, jsonb, text) to service_role;

create or replace function public.notify_vendor_booking_events()
returns trigger
language plpgsql
security definer
as $$
declare
  vendor_user_id uuid;
  builder_user_id uuid;
  vendor_name text;
begin
  select user_id, coalesce(name, 'Vendor')
  into vendor_user_id, vendor_name
  from public.vendor_profiles
  where id = new.vendor_id;

  select bp.user_id
  into builder_user_id
  from public.events e
  join public.builder_profiles bp on bp.id = e.builder_id
  where e.id = new.event_id;

  if tg_op = 'INSERT' and new.status = 'pending' and vendor_user_id is not null then
    perform public.insert_grouped_notification(
      vendor_user_id,
      'new_booking',
      'New booking request',
      'You have a new vendor booking request.',
      '/vendor/bookings',
      new.id,
      jsonb_build_object('booking_id', new.id, 'event_id', new.event_id, 'vendor_id', new.vendor_id),
      vendor_user_id::text || ':new_booking:' || new.id::text
    );
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'confirmed' and builder_user_id is not null then
      perform public.insert_grouped_notification(
        builder_user_id,
        'booking_approved',
        'Booking approved',
        vendor_name || ' approved your booking request.',
        '/builder/events',
        new.id,
        jsonb_build_object('booking_id', new.id, 'event_id', new.event_id, 'vendor_id', new.vendor_id),
        builder_user_id::text || ':booking_approved:' || new.id::text
      );
    elsif new.status = 'declined' and builder_user_id is not null then
      perform public.insert_grouped_notification(
        builder_user_id,
        'booking_rejected',
        'Booking declined',
        vendor_name || ' declined your booking request.',
        '/builder/events',
        new.id,
        jsonb_build_object('booking_id', new.id, 'event_id', new.event_id, 'vendor_id', new.vendor_id),
        builder_user_id::text || ':booking_rejected:' || new.id::text
      );
    elsif new.status = 'cancelled' then
      if builder_user_id is not null then
        perform public.insert_grouped_notification(
          builder_user_id,
          'booking_cancelled',
          'Booking cancelled',
          'A vendor booking was cancelled.',
          '/builder/events',
          new.id,
          jsonb_build_object('booking_id', new.id, 'event_id', new.event_id, 'vendor_id', new.vendor_id),
          builder_user_id::text || ':booking_cancelled:' || new.id::text
        );
      end if;

      if vendor_user_id is not null then
        perform public.insert_grouped_notification(
          vendor_user_id,
          'booking_cancelled',
          'Booking cancelled',
          'A booking on your calendar was cancelled.',
          '/vendor/bookings',
          new.id,
          jsonb_build_object('booking_id', new.id, 'event_id', new.event_id, 'vendor_id', new.vendor_id),
          vendor_user_id::text || ':booking_cancelled:' || new.id::text
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists notify_vendor_booking_events_after_write on public.vendor_bookings;
create trigger notify_vendor_booking_events_after_write
  after insert or update of status on public.vendor_bookings
  for each row execute function public.notify_vendor_booking_events();

create or replace function public.notify_vendor_transaction_events()
returns trigger
language plpgsql
security definer
as $$
declare
  vendor_user_id uuid;
begin
  if new.status not in ('succeeded') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select user_id
  into vendor_user_id
  from public.vendor_profiles
  where id = new.vendor_id;

  if vendor_user_id is not null then
    perform public.insert_grouped_notification(
      vendor_user_id,
      'payment_received',
      'Payment received',
      'A payment was received for one of your bookings.',
      '/vendor/payouts',
      new.booking_id,
      jsonb_build_object('booking_id', new.booking_id, 'transaction_id', new.id, 'amount', new.amount),
      vendor_user_id::text || ':payment_received:' || new.id::text
    );
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.vendor_transactions') is not null then
    execute 'drop trigger if exists notify_vendor_transaction_events_after_write on public.vendor_transactions';
    execute 'create trigger notify_vendor_transaction_events_after_write
      after insert or update of status on public.vendor_transactions
      for each row execute function public.notify_vendor_transaction_events()';
  end if;
end $$;

create or replace function public.notify_review_events()
returns trigger
language plpgsql
security definer
as $$
declare
  reviewee_user_id uuid;
  vendor_user_id uuid;
begin
  if new.vendor_id is not null then
    select user_id into vendor_user_id from public.vendor_profiles where id = new.vendor_id;
  end if;

  if vendor_user_id is not null then
    perform public.insert_grouped_notification(
      vendor_user_id,
      'review_received',
      'New review received',
      'You received a new review.',
      '/vendor/services',
      new.id,
      jsonb_build_object('review_id', new.id, 'vendor_id', new.vendor_id, 'rating', new.rating),
      vendor_user_id::text || ':review_received:' || new.id::text
    );
  elsif new.reviewee_id is not null then
    reviewee_user_id := new.reviewee_id;
    perform public.insert_grouped_notification(
      reviewee_user_id,
      'review_received',
      'New review received',
      'You received a new review.',
      null,
      new.id,
      jsonb_build_object('review_id', new.id, 'rating', new.rating),
      reviewee_user_id::text || ':review_received:' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_review_events_after_insert on public.reviews;
create trigger notify_review_events_after_insert
  after insert on public.reviews
  for each row execute function public.notify_review_events();
