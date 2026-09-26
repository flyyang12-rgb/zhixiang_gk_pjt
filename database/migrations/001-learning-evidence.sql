-- Additive, repeatable migration. Run only against an explicitly selected
-- database after backup; no student/profile or legacy table is altered.
CREATE TABLE IF NOT EXISTS public.learning_content_batches (
  id uuid PRIMARY KEY,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','active','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  activated_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  CHECK (status <> 'active' OR activated_at IS NOT NULL),
  CHECK (status <> 'withdrawn' OR (withdrawn_at IS NOT NULL AND length(btrim(withdrawal_reason)) > 0 AND withdrawal_reason IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.major_learning_evidence (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.learning_content_batches(id),
  fact_key text NOT NULL CHECK (length(btrim(fact_key)) BETWEEN 1 AND 160),
  major_id bigint NOT NULL REFERENCES public.majors(id),
  artifact_id uuid NOT NULL REFERENCES public.source_artifacts(id),
  kind text NOT NULL CHECK (kind IN ('curriculum','learning_activity','learning_prerequisite','course_prerequisite','admission_requirement','career_direction','career_requirement')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 2000),
  publisher_type text NOT NULL CHECK (publisher_type IN ('education_authority','university','professional_authority')),
  locator_kind text NOT NULL CHECK (locator_kind IN ('page','section','anchor')),
  locator_value text NOT NULL CHECK (length(btrim(locator_value)) BETWEEN 1 AND 500),
  scope_level text NOT NULL CHECK (scope_level IN ('major','school')),
  school_id bigint REFERENCES public.schools(id),
  province text,
  subject_group text,
  admission_year smallint CHECK (admission_year BETWEEN 2000 AND 2100),
  condition jsonb,
  job_direction_id bigint,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','verified','conflicting','rejected','withdrawn')),
  reviewer text,
  reviewed_at timestamptz,
  review_conclusion text CHECK (review_conclusion IN ('verified','conflicting','rejected','withdrawn')),
  review_reason text,
  valid_until timestamptz,
  CONSTRAINT uk_learning_batch_fact UNIQUE (batch_id,fact_key),
  CONSTRAINT fk_learning_career_mapping FOREIGN KEY (major_id,job_direction_id) REFERENCES public.major_job_directions(major_id,job_direction_id),
  CONSTRAINT ck_learning_school_scope CHECK ((scope_level='school' AND school_id IS NOT NULL) OR (scope_level='major' AND school_id IS NULL)),
  CONSTRAINT ck_learning_career_direction CHECK (kind <> 'career_direction' OR job_direction_id IS NOT NULL),
  CONSTRAINT ck_learning_admission_scope CHECK (
    (kind='admission_requirement' AND condition IS NOT NULL AND admission_year IS NOT NULL AND
      province IS NOT NULL AND length(btrim(province)) > 0 AND subject_group IS NOT NULL AND length(btrim(subject_group)) > 0)
    OR (kind <> 'admission_requirement' AND condition IS NULL)
  ),
  CONSTRAINT ck_learning_subject_condition CHECK (condition IS NULL OR COALESCE(
    jsonb_typeof(condition)='object' AND condition->>'type'='subjects' AND
    condition->>'mode' IN ('all','any','unrestricted') AND jsonb_typeof(condition->'subjects')='array' AND
    (condition->'subjects') <@ '["物理","历史","化学","生物","政治","地理"]'::jsonb AND
    ((condition->>'mode'='unrestricted' AND condition->'subjects'='[]'::jsonb) OR
     (condition->>'mode' IN ('all','any') AND condition->'subjects'<>'[]'::jsonb)), false)),
  CONSTRAINT ck_learning_review CHECK (
    (review_status='pending' AND review_conclusion IS NULL) OR
    (review_status<>'pending' AND review_conclusion IS NOT NULL AND review_conclusion=review_status AND
      reviewer IS NOT NULL AND length(btrim(reviewer)) BETWEEN 1 AND 100 AND reviewed_at IS NOT NULL AND
      review_reason IS NOT NULL AND length(btrim(review_reason)) BETWEEN 1 AND 1000)
  ),
  CONSTRAINT ck_learning_validity CHECK (valid_until IS NULL OR reviewed_at IS NULL OR valid_until >= reviewed_at)
);

CREATE INDEX IF NOT EXISTS idx_learning_major_review ON public.major_learning_evidence(major_id,review_status);
CREATE INDEX IF NOT EXISTS idx_learning_scope ON public.major_learning_evidence(province,subject_group,admission_year,school_id) WHERE kind='admission_requirement';
CREATE INDEX IF NOT EXISTS idx_learning_artifact ON public.major_learning_evidence(artifact_id);
CREATE INDEX IF NOT EXISTS idx_learning_job_mapping ON public.major_learning_evidence(major_id,job_direction_id) WHERE job_direction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_school ON public.major_learning_evidence(school_id) WHERE school_id IS NOT NULL;

ALTER TABLE public.learning_content_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.major_learning_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.learning_content_batches, public.major_learning_evidence FROM PUBLIC, anon, authenticated;
