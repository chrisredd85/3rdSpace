-- ============================================================================
-- DOCUMENT FILE LIBRARY METADATA
-- ============================================================================

alter table public.documents
  add column if not exists file_type text,
  add column if not exists original_file_name text,
  add column if not exists document_group_id uuid,
  add column if not exists version integer not null default 1;

alter table public.documents
  drop constraint if exists documents_file_type_check;

alter table public.documents
  add constraint documents_file_type_check
    check (file_type is null or file_type in ('pdf', 'image', 'document', 'spreadsheet', 'other'));

alter table public.documents
  drop constraint if exists documents_version_check;

alter table public.documents
  add constraint documents_version_check
    check (version >= 1);

update public.documents
set
  original_file_name = coalesce(original_file_name, file_name, split_part(file_url, '/', array_length(string_to_array(file_url, '/'), 1))),
  document_group_id = coalesce(document_group_id, id),
  file_type = coalesce(
    file_type,
    case
      when lower(coalesce(mime_type, file_name, file_url)) like '%pdf%' then 'pdf'
      when lower(coalesce(mime_type, file_name, file_url)) like '%image%' then 'image'
      when lower(coalesce(mime_type, file_name, file_url)) like '%word%'
        or lower(coalesce(file_name, file_url)) like '%.doc'
        or lower(coalesce(file_name, file_url)) like '%.docx'
        or lower(coalesce(mime_type, '')) = 'text/plain' then 'document'
      when lower(coalesce(mime_type, file_name, file_url)) like '%spreadsheet%'
        or lower(coalesce(mime_type, file_name, file_url)) like '%excel%'
        or lower(coalesce(mime_type, file_name, file_url)) like '%csv%'
        or lower(coalesce(file_name, file_url)) like '%.xls'
        or lower(coalesce(file_name, file_url)) like '%.xlsx' then 'spreadsheet'
      else 'other'
    end
  )
where original_file_name is null
   or document_group_id is null
   or file_type is null;

create index if not exists idx_documents_group_version
  on public.documents(document_group_id, version desc);

create index if not exists idx_documents_related_file_type
  on public.documents(related_type, related_id, file_type);

create index if not exists idx_documents_file_name_search
  on public.documents using gin (to_tsvector('english', coalesce(file_name, '') || ' ' || coalesce(original_file_name, '')));
