-- Gate B: prevent new audit copies of request-only Google photo content.
-- This does not rewrite historical audit rows, plans, approvals, or commitments.
-- Keep photo-only matching aligned with lib/discovery/googlePhotoPersistence.ts.
CREATE SCHEMA IF NOT EXISTS private;

-- Pure recursive traversal: no exception blocks or per-node subtransactions.
-- The audit INSERT trigger owns the single fail-open boundary for both snapshots.
CREATE OR REPLACE FUNCTION private.strip_google_photo_audit_json(p_value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_photo_pattern CONSTANT TEXT := $photo$https?://places\.googleapis\.com/[^\s"'<>]*/photos/[^\s"'<>]*|https?://maps\.googleapis\.com/maps/api/place/photo[^\s"'<>]*|https?://lh\d*\.googleusercontent\.com/(?:places|p)/[^\s"'<>]*|places(?:/|%2f)[^\s"'<>]+?(?:/|%2f)photos(?:/|%2f)[^\s"'<>]+$photo$;
  v_text TEXT;
  v_parsed JSONB;
  v_sanitized JSONB;
  v_result JSONB;
  v_key TEXT;
  v_entry JSONB;
  v_item JSONB;
  v_photos JSONB;
  v_photo_shape BOOLEAN;
  v_photo_data BOOLEAN;
  v_photo_credit BOOLEAN;
BEGIN
  IF jsonb_typeof(p_value) = 'string' THEN
    v_text := p_value #>> '{}';
    -- Serialized model/message JSON can contain opaque legacy photo keys.
    -- Our own redaction marker is prose, not a JSON array. Keep repeat passes
    -- idempotent while still redacting any later photo URLs in the same string.
    IF v_text ~ '^\s*[\[{]' AND v_text !~ '^\s*\[Google photo omitted\]' THEN
      v_parsed := v_text::JSONB;
      IF v_parsed IS NOT NULL THEN
        v_sanitized := private.strip_google_photo_audit_json(v_parsed);
        IF v_sanitized IS DISTINCT FROM v_parsed THEN
          RETURN to_jsonb(v_sanitized::TEXT);
        END IF;
      END IF;
    END IF;
    RETURN to_jsonb(regexp_replace(v_text, v_photo_pattern, '[Google photo omitted]', 'gi'));
  END IF;

  IF jsonb_typeof(p_value) = 'array' THEN
    v_result := '[]'::JSONB;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      v_sanitized := private.strip_google_photo_audit_json(v_item);
      -- A recognized Google photo object is omitted; ordinary JSON null stays.
      IF jsonb_typeof(v_item) = 'object' AND v_sanitized = 'null'::JSONB THEN
        CONTINUE;
      END IF;
      v_result := v_result || jsonb_build_array(v_sanitized);
    END LOOP;
    RETURN v_result;
  END IF;

  IF jsonb_typeof(p_value) <> 'object' THEN
    RETURN p_value;
  END IF;

  v_photo_data := COALESCE((
    jsonb_typeof(p_value->'attribution') = 'object'
    AND ((p_value->'attribution') ? 'authorAttributions' OR (p_value->'attribution') ? 'googleMapsUri')
  ), FALSE);
  v_photo_credit := COALESCE((
    jsonb_typeof(p_value->'authorAttributions') = 'array'
  ), FALSE);
  -- An incidental image must never erase its containing business/financial row.
  v_photo_shape := NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_value) AS keys(key)
    WHERE key <> ALL (ARRAY[
      'name', 'url', 'photo_url', 'photoUri', 'heightPx', 'widthPx', 'width', 'height',
      'caption', 'source', 'authorAttributions', 'googleMapsUri',
      'dataUrl', 'attribution', 'entityType', 'entityId', 'index'
    ])
  );
  IF v_photo_shape AND (
    (v_photo_data AND jsonb_typeof(p_value->'dataUrl') = 'string')
    OR (v_photo_credit AND jsonb_typeof(p_value->'googleMapsUri') = 'string')
  ) THEN
    RETURN 'null'::JSONB;
  END IF;

  IF v_photo_shape THEN
    FOREACH v_key IN ARRAY ARRAY['name', 'photoUri', 'photo_url', 'url'] LOOP
      IF jsonb_typeof(p_value->v_key) = 'string' AND (p_value->>v_key) ~* v_photo_pattern THEN
        RETURN 'null'::JSONB;
      END IF;
    END LOOP;
  END IF;

  v_result := '{}'::JSONB;
  FOR v_key, v_entry IN SELECT key, value FROM jsonb_each(p_value) LOOP
    IF v_key = ANY (ARRAY[
      'google_photo_names', 'google_photos', 'places_photos', 'photo_reference',
      'photo_references', 'photoReference', 'photoreference', 'photoName', 'photo_name',
      'authorAttributions', 'photoUri', 'photo_uri'
    ]) THEN
      CONTINUE;
    END IF;
    IF (v_photo_data AND v_key = 'dataUrl') OR (v_photo_credit AND v_key = 'googleMapsUri') THEN
      CONTINUE;
    END IF;

    IF v_key = 'photos' AND (
      p_value->>'source' = 'google_places' OR jsonb_typeof(p_value->'google_place_id') = 'string'
    ) THEN
      -- Preserve independently hosted images even in a mixed-origin row.
      -- Opaque strings in a provider photo container are legacy resource names.
      v_photos := '[]'::JSONB;
      IF jsonb_typeof(v_entry) = 'array' THEN
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_entry) LOOP
          IF (jsonb_typeof(v_item) = 'string' AND (v_item #>> '{}') ~* '^https?://')
            OR (jsonb_typeof(v_item) = 'object' AND (
              jsonb_typeof(v_item->'url') = 'string' OR jsonb_typeof(v_item->'image_url') = 'string'
            )) THEN
            v_photos := v_photos || jsonb_build_array(v_item);
          END IF;
        END LOOP;
      END IF;
      v_entry := v_photos;
    END IF;
    v_result := v_result || jsonb_build_object(v_key, private.strip_google_photo_audit_json(v_entry));
  END LOOP;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fence_new_audit_google_photos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_before_state JSONB := NEW.before_state;
  v_after_state JSONB := NEW.after_state;
BEGIN
  NEW.before_state := private.strip_google_photo_audit_json(NEW.before_state);
  NEW.after_state := private.strip_google_photo_audit_json(NEW.after_state);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Single fail-open boundary per audit row, independent of JSON size/depth.
  -- A conversion/processing error in either traversal preserves BOTH complete
  -- originals, even if the first snapshot was already sanitized. Photo tokens
  -- may therefore remain anywhere in that row: the accepted whole-snapshot gap.
  NEW.before_state := v_before_state;
  NEW.after_state := v_after_state;
  RETURN NEW;
END;
$function$;

-- Private implementation functions are not callable application RPCs. The trigger
-- executes its own narrowly scoped wrapper and never modifies another record.
REVOKE ALL ON FUNCTION private.strip_google_photo_audit_json(JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.fence_new_audit_google_photos() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS fence_new_audit_google_photos ON public.audit_logs;
CREATE TRIGGER fence_new_audit_google_photos
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.fence_new_audit_google_photos();

COMMENT ON FUNCTION private.strip_google_photo_audit_json(JSONB) IS
  'Photo-only sanitizer for newly inserted audit snapshots; preserves independent images and does not grant retention rights for other Google content.';
COMMENT ON TRIGGER fence_new_audit_google_photos ON public.audit_logs IS
  'Sanitizes NEW before_state/after_state only. No historical rewrite, UPDATE trigger, plan mutation, approval hash change, or commitment rejection.';
