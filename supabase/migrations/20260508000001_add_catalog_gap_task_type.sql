ALTER TABLE public.admin_tasks
  DROP CONSTRAINT IF EXISTS admin_tasks_task_type_check;

ALTER TABLE public.admin_tasks
  DROP CONSTRAINT IF EXISTS admin_tasks_type_check;

ALTER TABLE public.admin_tasks
  ADD CONSTRAINT admin_tasks_task_type_check
  CHECK (task_type IN (
    'concierge_booking',
    'receipt_upload',
    'vendor_confirm',
    'coi_collect',
    'catalog_gap'
  ));

ALTER TABLE public.admin_tasks
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.admin_tasks
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.admin_tasks
  DROP CONSTRAINT IF EXISTS admin_tasks_status_check;

ALTER TABLE public.admin_tasks
  ADD CONSTRAINT admin_tasks_status_check
  CHECK (status IN ('pending', 'open', 'in_progress', 'complete', 'cancelled'));

ALTER TABLE public.admin_tasks
  DROP CONSTRAINT IF EXISTS admin_tasks_priority_check;

ALTER TABLE public.admin_tasks
  ADD CONSTRAINT admin_tasks_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
