-- Add leading indicators to compression table (FR-014)

ALTER TABLE compression ADD COLUMN convergence_first_pass_rate REAL;
ALTER TABLE compression ADD COLUMN convergence_avg_attempts REAL;
ALTER TABLE compression ADD COLUMN density_lines_per_sp REAL;
ALTER TABLE compression ADD COLUMN density_files_per_sp REAL;
ALTER TABLE compression ADD COLUMN density_tool_calls_per_sp REAL;
ALTER TABLE compression ADD COLUMN spec_quality_contract_count INTEGER;
ALTER TABLE compression ADD COLUMN spec_quality_gate_count INTEGER;
