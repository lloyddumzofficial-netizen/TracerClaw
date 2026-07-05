-- Run this in your Supabase SQL Editor

-- 1. Create the Payment Requests table
CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  email text NOT NULL,
  plan text NOT NULL,
  reference_number text NOT NULL,
  proof_url text NOT NULL,
  status text DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payment requests" 
ON payment_requests FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own payment requests" 
ON payment_requests FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- 3. Create Storage Bucket for Proof of Payments
INSERT INTO storage.buckets (id, name, public) 
VALUES ('payment_proofs', 'payment_proofs', true) 
ON CONFLICT (id) DO NOTHING;

-- 4. Set up Storage Policies so users can upload and view
CREATE POLICY "Users can upload payment proofs" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'payment_proofs' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view payment proofs" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'payment_proofs');
