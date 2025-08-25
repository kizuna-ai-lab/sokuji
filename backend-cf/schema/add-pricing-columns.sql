-- Migration to add pricing-related columns to usage_logs table
-- This allows tracking both raw and adjusted token amounts

-- Add columns to usage_logs table to track adjusted tokens and pricing ratios
ALTER TABLE usage_logs ADD COLUMN adjusted_input_tokens INTEGER;
ALTER TABLE wallet_ledger DROP COLUMN raw
ALTER TABLE usage_logs ADD COLUMN adjusted_output_tokens INTEGER;
ALTER TABLE usage_logs ADD COLUMN adjusted_total_tokens INTEGER;
ALTER TABLE usage_logs ADD COLUMN input_ratio REAL;
ALTER TABLE usage_logs ADD COLUMN output_ratio REAL;
ALTER TABLE usage_logs ADD COLUMN modality TEXT; -- 'text' or 'audio'

-- Create index for modality column for performance
CREATE INDEX IF NOT EXISTS idx_usage_logs_modality ON usage_logs(modality);

-- View to easily see token adjustments
CREATE VIEW IF NOT EXISTS usage_with_adjustments AS
SELECT 
  ul.id,
  ul.subject_type,
  ul.subject_id,
  ul.provider,
  ul.model,
  ul.modality,
  ul.event_type,
  ul.total_tokens as raw_total_tokens,
  ul.input_tokens as raw_input_tokens,
  ul.output_tokens as raw_output_tokens,
  ul.adjusted_total_tokens,
  ul.adjusted_input_tokens,
  ul.adjusted_output_tokens,
  ul.input_ratio,
  ul.output_ratio,
  ROUND((ul.adjusted_total_tokens - ul.total_tokens) * 100.0 / ul.total_tokens, 2) as adjustment_percentage,
  ul.created_at
FROM usage_logs ul
WHERE ul.adjusted_total_tokens IS NOT NULL;

-- View to see daily token usage with adjustments
CREATE VIEW IF NOT EXISTS daily_usage_summary AS
SELECT 
  DATE(created_at) as usage_date,
  subject_type,
  subject_id,
  provider,
  model,
  modality,
  COUNT(*) as request_count,
  SUM(total_tokens) as raw_tokens_total,
  SUM(adjusted_total_tokens) as adjusted_tokens_total,
  AVG(input_ratio) as avg_input_ratio,
  AVG(output_ratio) as avg_output_ratio,
  ROUND((SUM(adjusted_total_tokens) - SUM(total_tokens)) * 100.0 / SUM(total_tokens), 2) as adjustment_percentage
FROM usage_logs
WHERE adjusted_total_tokens IS NOT NULL
GROUP BY DATE(created_at), subject_type, subject_id, provider, model, modality;

-- View to see profitability by model
CREATE VIEW IF NOT EXISTS model_profitability AS
SELECT 
  provider,
  model,
  modality,
  COUNT(*) as total_requests,
  SUM(total_tokens) as total_raw_tokens,
  SUM(adjusted_total_tokens) as total_adjusted_tokens,
  AVG(input_ratio) as avg_input_ratio,
  AVG(output_ratio) as avg_output_ratio,
  ROUND((SUM(adjusted_total_tokens) * 10.0 / 1000000), 2) as revenue_usd,
  ROUND((SUM(adjusted_total_tokens) - SUM(total_tokens)) * 10.0 / 1000000, 2) as profit_margin_usd
FROM usage_logs
WHERE adjusted_total_tokens IS NOT NULL
GROUP BY provider, model, modality
ORDER BY total_adjusted_tokens DESC;