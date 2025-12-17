-- Add image_urls column for multi-image sessions
-- Stores ordered list of uploaded image public URLs (jsonb array)

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS image_urls jsonb;

COMMENT ON COLUMN public.sessions.image_urls IS 'Public URLs for uploaded images (array, ordered)';

-- Backfill: if image_urls is missing but image_url exists, set single-item array
UPDATE public.sessions
SET image_urls = jsonb_build_array(image_url)
WHERE image_urls IS NULL
  AND image_url IS NOT NULL;
