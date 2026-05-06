-- Add PR tracking to runs table
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
