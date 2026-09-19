-- Expand Mockup Studio from one jersey construction to locked garment templates.

ALTER TABLE public.mockup_projects
  DROP CONSTRAINT IF EXISTS mockup_projects_garment_type_check;

UPDATE public.mockup_projects
SET garment_type = 'raglan_jersey', template_version = 'garment-catalog-v2'
WHERE garment_type = 'sports_raglan';

ALTER TABLE public.mockup_projects
  ALTER COLUMN garment_type SET DEFAULT 'raglan_jersey';

ALTER TABLE public.mockup_projects
  ADD CONSTRAINT mockup_projects_garment_type_check CHECK (garment_type IN (
    'sports_tshirt',
    'vneck_jersey',
    'raglan_jersey',
    'polo_jersey',
    'chinese_collar_jersey',
    'long_sleeve_jersey',
    'basketball_jersey',
    'basketball_shorts',
    'basketball_kit'
  ));

ALTER TABLE public.mockup_assets
  DROP CONSTRAINT IF EXISTS mockup_assets_role_check;

ALTER TABLE public.mockup_assets
  ADD CONSTRAINT mockup_assets_role_check CHECK (role IN (
    'front', 'back', 'left_sleeve', 'right_sleeve',
    'collar', 'placket', 'left_cuff', 'right_cuff',
    'left_side_panel', 'right_side_panel',
    'shorts_front', 'shorts_back', 'shorts_left_side', 'shorts_right_side',
    'waistband', 'logo', 'style_reference'
  ));

NOTIFY pgrst, 'reload schema';
