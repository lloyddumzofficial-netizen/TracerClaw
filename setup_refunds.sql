-- 1. Add `credit_deducted` and `refunded` columns to `projects` table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS credit_deducted boolean DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS refunded boolean DEFAULT false;

-- 2. Create a secure function to handle refunds
CREATE OR REPLACE FUNCTION refund_credit(target_user_id uuid, target_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only refund if the project HAS deducted a credit and HAS NOT been refunded yet
    UPDATE projects
    SET refunded = true
    WHERE id = target_project_id 
      AND user_id = target_user_id 
      AND credit_deducted = true 
      AND refunded = false;

    -- If the above update actually changed a row (meaning it was a valid refund condition), add 1 credit
    IF FOUND THEN
        UPDATE profiles
        SET credits = credits + 1
        WHERE id = target_user_id;
    END IF;
END;
$$;
