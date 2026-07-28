-- Create a table for public profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  credits INTEGER DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Turn on Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own profile
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

-- NEVER allow users to update their own profile from the client.
-- Updates to credits should only happen via Service Role Key in the backend API.

-- Trigger to automatically create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, credits, is_admin)
  VALUES (new.id, new.email, 0, FALSE);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists to avoid errors on multiple runs
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- We also need to secure the projects table so users can only see their own projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- If we want RLS on projects (highly recommended for security):
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own projects
CREATE POLICY "Users can view own projects" 
  ON public.projects FOR SELECT 
  USING (auth.uid() = user_id OR user_id IS NULL); -- IS NULL for backwards compatibility

-- Allow users to insert their own projects
CREATE POLICY "Users can insert own projects" 
  ON public.projects FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Allow users to update their own projects
CREATE POLICY "Users can update own projects" 
  ON public.projects FOR UPDATE 
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Allow users to delete their own projects
CREATE POLICY "Users can delete own projects" 
  ON public.projects FOR DELETE 
  USING (auth.uid() = user_id OR user_id IS NULL);

NOTIFY pgrst, 'reload schema';
