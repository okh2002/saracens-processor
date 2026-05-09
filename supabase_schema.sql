-- Add render_url, schematic_key, and world_key columns to cities table
-- Run this in the Supabase SQL editor

ALTER TABLE cities ADD COLUMN IF NOT EXISTS render_url text;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS schematic_key text;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS world_key text;
