-- ============================================================================
-- EVENT DOCUMENTS + VENDOR STORAGE HARDENING
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vendor-photos', 'vendor-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('vendor-documents', 'vendor-documents', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Event team can view event documents metadata" on public.documents;
create policy "Event team can view event documents metadata"
on public.documents
for select
using (
  uploader_id = auth.uid()
  or (
    related_type = 'event'
    and (
      related_id in (
        select collaborators.event_id
        from public.collaborators
        where collaborators.user_id = auth.uid()
      )
      or related_id in (
        select events.id
        from public.events
        where events.builder_id = auth.uid()
      )
    )
  )
);

drop policy if exists "Authenticated users can create own documents" on public.documents;
create policy "Authenticated users can create own documents"
on public.documents
for insert
with check (
  uploader_id = auth.uid()
  and (
    (related_type = 'user' and related_id = auth.uid())
    or (
      related_type = 'event'
      and (
        related_id in (
          select collaborators.event_id
          from public.collaborators
          where collaborators.user_id = auth.uid()
        )
        or related_id in (
          select events.id
          from public.events
          where events.builder_id = auth.uid()
        )
      )
    )
  )
);

drop policy if exists "Users can delete their own documents" on public.documents;
create policy "Users can delete their own documents"
on public.documents
for delete
using (
  uploader_id = auth.uid()
  or (
    related_type = 'event'
    and (
      related_id in (
        select collaborators.event_id
        from public.collaborators
        where collaborators.user_id = auth.uid()
      )
      or related_id in (
        select events.id
        from public.events
        where events.builder_id = auth.uid()
      )
    )
  )
);

drop policy if exists "Vendor offerings are publicly viewable" on public.vendor_offerings;
create policy "Vendor offerings are publicly viewable"
on public.vendor_offerings
for select
using (true);

drop policy if exists "Vendors can create own offerings" on public.vendor_offerings;
create policy "Vendors can create own offerings"
on public.vendor_offerings
for insert
with check (
  vendor_id in (
    select vendor_profiles.id
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can update own offerings" on public.vendor_offerings;
create policy "Vendors can update own offerings"
on public.vendor_offerings
for update
using (
  vendor_id in (
    select vendor_profiles.id
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
)
with check (
  vendor_id in (
    select vendor_profiles.id
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can delete own offerings" on public.vendor_offerings;
create policy "Vendors can delete own offerings"
on public.vendor_offerings
for delete
using (
  vendor_id in (
    select vendor_profiles.id
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Public can view vendor photos" on storage.objects;
create policy "Public can view vendor photos"
on storage.objects
for select
using (bucket_id = 'vendor-photos');

drop policy if exists "Vendors can upload own photos" on storage.objects;
create policy "Vendors can upload own photos"
on storage.objects
for insert
with check (
  bucket_id = 'vendor-photos'
  and (storage.foldername(name))[1] in (
    select vendor_profiles.id::text
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can delete own photos" on storage.objects;
create policy "Vendors can delete own photos"
on storage.objects
for delete
using (
  bucket_id = 'vendor-photos'
  and (storage.foldername(name))[1] in (
    select vendor_profiles.id::text
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can view own documents" on storage.objects;
create policy "Vendors can view own documents"
on storage.objects
for select
using (
  bucket_id = 'vendor-documents'
  and (storage.foldername(name))[1] in (
    select vendor_profiles.id::text
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can upload own documents" on storage.objects;
create policy "Vendors can upload own documents"
on storage.objects
for insert
with check (
  bucket_id = 'vendor-documents'
  and (storage.foldername(name))[1] in (
    select vendor_profiles.id::text
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);

drop policy if exists "Vendors can delete own documents" on storage.objects;
create policy "Vendors can delete own documents"
on storage.objects
for delete
using (
  bucket_id = 'vendor-documents'
  and (storage.foldername(name))[1] in (
    select vendor_profiles.id::text
    from public.vendor_profiles
    where vendor_profiles.user_id = auth.uid()
  )
);
