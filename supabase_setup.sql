-- ─────────────────────────────────────────────
-- FitAI — Setup das tabelas no Supabase
-- Cole este SQL em: Supabase → SQL Editor → Run
-- ─────────────────────────────────────────────

-- Check-ins de treino
CREATE TABLE IF NOT EXISTS checkins (
  date    DATE PRIMARY KEY,
  done    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico de peso
CREATE TABLE IF NOT EXISTS weight_log (
  date    DATE PRIMARY KEY,
  kg      NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Programa de treino e dieta (1 registro por usuário)
CREATE TABLE IF NOT EXISTS program (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  profile      JSONB,
  workout_plan JSONB,
  diet_plan    JSONB,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Cargas registradas por dia
CREATE TABLE IF NOT EXISTS cargas (
  date    DATE PRIMARY KEY,
  data    JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar acesso via API (Row Level Security desligado para uso pessoal)
ALTER TABLE checkins  DISABLE ROW LEVEL SECURITY;
ALTER TABLE weight_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE program   DISABLE ROW LEVEL SECURITY;
ALTER TABLE cargas    DISABLE ROW LEVEL SECURITY;
