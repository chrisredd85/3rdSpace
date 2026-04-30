-- ============================================================================
-- VENDOR ANALYTICS MATERIALIZED VIEW + HELPERS
-- ============================================================================

alter table public.vendor_bookings
  drop constraint if exists valid_vendor_booking_status;

alter table public.vendor_bookings
  add constraint valid_vendor_booking_status
    check (status in ('pending', 'confirmed', 'declined', 'cancelled', 'completed'));

drop materialized view if exists public.vendor_analytics;

create materialized view public.vendor_analytics as
with booking_amounts as (
  select
    vb.*,
    coalesce(vb.total_amount, vb.final_price, vb.quoted_price, 0)::numeric as booking_amount,
    coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) as metric_date
  from public.vendor_bookings vb
),
booking_rollup as (
  select
    vendor_id,
    count(*)::bigint as total_bookings,
    count(*) filter (where status = 'confirmed')::bigint as confirmed_bookings,
    count(*) filter (where status = 'completed')::bigint as completed_bookings,
    count(*) filter (where status in ('cancelled', 'declined'))::bigint as cancelled_bookings,
    coalesce(sum(booking_amount) filter (where status in ('confirmed', 'completed')), 0)::numeric as total_revenue,
    coalesce(avg(booking_amount) filter (where status in ('confirmed', 'completed')), 0)::numeric as avg_booking_value,
    coalesce(avg(extract(epoch from (responded_at - created_at)) / 3600) filter (where responded_at is not null), 0)::numeric as avg_response_hours,
    case
      when count(*) filter (where status in ('confirmed', 'declined', 'cancelled', 'completed')) = 0 then 0
      else (
        count(*) filter (where status in ('confirmed', 'completed'))::numeric
        / count(*) filter (where status in ('confirmed', 'declined', 'cancelled', 'completed'))::numeric
      ) * 100
    end as acceptance_rate,
    case
      when count(*) = 0 then 0
      else (count(*) filter (where status in ('confirmed', 'completed'))::numeric / count(*)::numeric) * 100
    end as conversion_rate,
    case
      when count(*) = 0 then 0
      else (count(*) filter (where status in ('cancelled', 'declined'))::numeric / count(*)::numeric) * 100
    end as cancellation_rate
  from booking_amounts
  group by vendor_id
),
review_rollup as (
  select
    vendor_id,
    coalesce(avg(rating), 0)::numeric as average_rating,
    count(*)::bigint as total_reviews
  from public.reviews
  where vendor_id is not null
  group by vendor_id
)
select
  vp.id as vendor_id,
  coalesce(br.total_revenue, 0)::numeric as total_revenue,
  coalesce(br.total_bookings, 0)::bigint as total_bookings,
  coalesce(br.confirmed_bookings, 0)::bigint as confirmed_bookings,
  coalesce(br.completed_bookings, 0)::bigint as completed_bookings,
  coalesce(br.cancelled_bookings, 0)::bigint as cancelled_bookings,
  coalesce(br.avg_booking_value, 0)::numeric as avg_booking_value,
  coalesce(br.avg_response_hours, 0)::numeric as avg_response_hours,
  coalesce(br.acceptance_rate, 0)::numeric as acceptance_rate,
  coalesce(br.conversion_rate, 0)::numeric as conversion_rate,
  coalesce(br.cancellation_rate, 0)::numeric as cancellation_rate,
  coalesce(rr.average_rating, vp.average_rating, vp.rating, 0)::numeric as average_rating,
  coalesce(rr.total_reviews, vp.review_count, 0)::bigint as total_reviews,
  now() as refreshed_at
from public.vendor_profiles vp
left join booking_rollup br on br.vendor_id = vp.id
left join review_rollup rr on rr.vendor_id = vp.id;

create unique index if not exists idx_vendor_analytics_vendor_id
  on public.vendor_analytics(vendor_id);

grant select on public.vendor_analytics to authenticated;
grant select on public.vendor_analytics to service_role;

create or replace function public.get_vendor_booking_amount(p_booking public.vendor_bookings)
returns numeric
language sql
stable
as $$
  select coalesce(p_booking.total_amount, p_booking.final_price, p_booking.quoted_price, 0)::numeric;
$$;

create or replace function public.get_vendor_revenue_by_month(
  p_vendor_id uuid,
  p_start_date date,
  p_end_date date default current_date
)
returns table(month text, revenue numeric)
language plpgsql
stable
as $$
begin
  return query
  select
    to_char(date_trunc('month', coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date)), 'YYYY-MM') as month,
    coalesce(sum(public.get_vendor_booking_amount(vb)), 0)::numeric as revenue
  from public.vendor_bookings vb
  where vb.vendor_id = p_vendor_id
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) >= p_start_date
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) <= p_end_date
    and vb.status in ('confirmed', 'completed')
  group by date_trunc('month', coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date))
  order by month;
end;
$$;

create or replace function public.get_vendor_bookings_by_month(
  p_vendor_id uuid,
  p_start_date date,
  p_end_date date default current_date
)
returns table(month text, bookings bigint)
language plpgsql
stable
as $$
begin
  return query
  select
    to_char(date_trunc('month', coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date)), 'YYYY-MM') as month,
    count(*)::bigint as bookings
  from public.vendor_bookings vb
  where vb.vendor_id = p_vendor_id
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) >= p_start_date
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) <= p_end_date
    and vb.status in ('confirmed', 'completed')
  group by date_trunc('month', coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date))
  order by month;
end;
$$;

create or replace function public.get_vendor_period_summary(
  p_vendor_id uuid,
  p_start_date date,
  p_end_date date
)
returns table(revenue numeric, bookings bigint, avg_booking_value numeric)
language plpgsql
stable
as $$
begin
  return query
  select
    coalesce(sum(public.get_vendor_booking_amount(vb)), 0)::numeric as revenue,
    count(*)::bigint as bookings,
    coalesce(avg(public.get_vendor_booking_amount(vb)), 0)::numeric as avg_booking_value
  from public.vendor_bookings vb
  where vb.vendor_id = p_vendor_id
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) >= p_start_date
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) <= p_end_date
    and vb.status in ('confirmed', 'completed');
end;
$$;

create or replace function public.get_vendor_pending_revenue(
  p_vendor_id uuid,
  p_start_date date default current_date
)
returns table(pending_revenue numeric)
language plpgsql
stable
as $$
begin
  return query
  select coalesce(sum(public.get_vendor_booking_amount(vb)), 0)::numeric as pending_revenue
  from public.vendor_bookings vb
  where vb.vendor_id = p_vendor_id
    and vb.status in ('pending', 'confirmed')
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) >= p_start_date;
end;
$$;

create or replace function public.get_vendor_popular_services(
  p_vendor_id uuid,
  p_start_date date,
  p_end_date date
)
returns table(service_name text, bookings bigint, revenue numeric)
language plpgsql
stable
as $$
begin
  return query
  select
    coalesce(vo.offering_name, vp.package_name, 'General booking')::text as service_name,
    count(*)::bigint as bookings,
    coalesce(sum(public.get_vendor_booking_amount(vb)), 0)::numeric as revenue
  from public.vendor_bookings vb
  left join public.vendor_offerings vo on vo.id = vb.vendor_offering_id
  left join public.vendor_packages vp on vp.id = vb.vendor_package_id
  where vb.vendor_id = p_vendor_id
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) >= p_start_date
    and coalesce(vb.confirmed_date, vb.requested_date, vb.booking_date, vb.created_at::date) <= p_end_date
    and vb.status in ('confirmed', 'completed')
  group by coalesce(vo.offering_name, vp.package_name, 'General booking')
  order by bookings desc, revenue desc
  limit 5;
end;
$$;

create or replace function public.refresh_vendor_analytics()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently public.vendor_analytics;
end;
$$;

grant execute on function public.get_vendor_revenue_by_month(uuid, date, date) to authenticated;
grant execute on function public.get_vendor_bookings_by_month(uuid, date, date) to authenticated;
grant execute on function public.get_vendor_period_summary(uuid, date, date) to authenticated;
grant execute on function public.get_vendor_pending_revenue(uuid, date) to authenticated;
grant execute on function public.get_vendor_popular_services(uuid, date, date) to authenticated;
grant execute on function public.refresh_vendor_analytics() to service_role;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'refresh-vendor-analytics-nightly',
  '15 8 * * *',
  'select public.refresh_vendor_analytics();'
)
where not exists (
  select 1
  from cron.job
  where jobname = 'refresh-vendor-analytics-nightly'
);
