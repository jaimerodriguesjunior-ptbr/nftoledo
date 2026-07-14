-- Identifies invoices sent through batch emission so monthly batch can
-- exclude only successful batch items and still allow individual invoices.
ALTER TABLE fiscal_invoices
  ADD COLUMN IF NOT EXISTS emission_origin text DEFAULT 'single';

CREATE INDEX IF NOT EXISTS fiscal_invoices_batch_month_idx
  ON fiscal_invoices (organization_id, mes_referencia, emission_origin, client_id, status);
