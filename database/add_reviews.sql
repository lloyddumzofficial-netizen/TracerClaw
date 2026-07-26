-- Add rating and feedback_text to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS rating smallint NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS feedback_text text NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewer_name text NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS reviewer_avatar text NULL;
