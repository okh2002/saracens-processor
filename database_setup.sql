-- Complete database setup for The Saracens platform
-- Run this in Supabase SQL editor

-- Create cities table if it doesn't exist
CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color INTEGER,
    is_leader BOOLEAN DEFAULT FALSE,
    is_asateen BOOLEAN DEFAULT FALSE,
    tier TEXT DEFAULT 'الأساة',
    render_url TEXT,
    schematic_key TEXT,
    world_key TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns to existing cities table (if they don't exist)
ALTER TABLE cities ADD COLUMN IF NOT EXISTS render_url TEXT;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS schematic_key TEXT;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS world_key TEXT;

-- Insert initial cities data if table is empty
INSERT INTO cities (id, name, color, is_leader, is_asateen, tier) VALUES
(0, 'مدينة القائد', 0x1A3A2A, TRUE, FALSE, 'القائد'),
(1, 'مدينة الفجر', 0x1A2A3A, FALSE, TRUE, 'الأساة'),
(2, 'مدينة الصخر', 0x2A1A1A, FALSE, TRUE, 'الأساة'),
(3, 'مدينة النور', 0x1A2A1A, FALSE, TRUE, 'الأساة'),
(4, 'مدينة الريح', 0x2A1A2A, FALSE, TRUE, 'الأساة')
ON CONFLICT (id) DO NOTHING;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_cities_id ON cities(id);
CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);

-- Enable Row Level Security (RLS)
ALTER TABLE cities ENABLE ROW LEVEL SECURITY;

-- Create policy for read access (everyone can read cities)
CREATE POLICY "Cities are viewable by everyone" ON cities
    FOR SELECT USING (true);

-- Create policy for update access (authenticated users can update cities)
CREATE POLICY "Authenticated users can update cities" ON cities
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_cities_updated_at 
    BEFORE UPDATE ON cities 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
