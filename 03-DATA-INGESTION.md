# Data Ingestion Pipeline

## Overview

The ingestion pipeline transforms raw Excel/CSV uploads into queryable Parquet files in Azure Blob Storage, with full metadata cataloged in PostgreSQL. The pipeline runs asynchronously via background workers, keeping the API responsive during large file processing.

## Pipeline Stages

### Stage 1: Upload & Queue

**Trigger:** User drops file in the UI or hits the upload endpoint.

**What happens:**
1. FastAPI receives the multipart upload
2. File is streamed directly to Azure Blob Storage: `raw/{model_id}/{upload_id}/{filename}`
3. Dataset record created in PostgreSQL with `status: "queued"`
4. ARQ job enqueued: `process_upload(model_id, upload_id, blob_path)`
5. API returns immediately with the dataset ID and `status: "queued"`

**Why Blob Storage first:** The raw file is preserved as an immutable audit trail. If the canonical schema evolves or a parsing bug is found, the file can be reprocessed without asking the user to re-upload.

### Stage 2: Parse & Detect

**Runs in:** ARQ background worker

**What happens:**
1. Worker downloads file from Blob Storage to local temp
2. **Calamine engine** (Rust-based, via `python-calamine` or Polars' calamine backend) parses Excel files — 10–50x faster than openpyxl on large workbooks
3. For multi-sheet Excel: each sheet parsed independently
4. Column name sanitization (German umlauts, special chars, deduplication)
5. **Type inference** per column:
   - Numeric detection (handles German `1.234,56` format)
   - Date pattern matching (ISO, DD.MM.YYYY, period formats)
   - Boolean detection (Yes/No, TRUE/FALSE, Ja/Nein)
   - Cardinality analysis (unique count, null ratio)
6. **Role classification** per column: measure, dimension, time, key, ignore
7. **Cross-sheet relationship detection:** matching column names with >50% value overlap
8. Dataset status updated to `status: "parsed"`

### Stage 3: Fact Type Classification

**Runs in:** Same ARQ worker, after parsing

**What happens:**
1. System checks the upload against known fact type definitions
2. For `financial_transactions`, the classification logic:
   - Scan for a monetary amount column (aliases: betrag, amount, wert, value, saldo...)
   - Scan for an account identifier column (aliases: konto, hauptkonto, account, gl_account...)
   - Scan for a period/date column (aliases: periode, period, monat, datum, date...)
   - If all three core columns are mappable → **match** with confidence score
   - Score boosted by number of expected columns also found
3. If no known type matches above threshold → classify as `custom`
4. Result: `fact_type: "financial_transactions"` or `fact_type: "custom"` stored on dataset record

### Stage 4: AI Schema Analysis

**Runs in:** Same ARQ worker, after classification

**What happens:**
1. Claude receives: column names, detected types, sample values (5–10 rows), and the target fact type schema (if matched)
2. For **financial_transactions** matches:
   - AI proposes column-to-canonical mapping (e.g., `hauptkonto` → `account_key`)
   - AI identifies chart-of-accounts sheets vs transaction sheets
   - AI suggests hierarchy information (account_type, account_group, P&L line)
   - AI detects sign conventions (are expenses negative? credit/debit split?)
3. For **custom** types:
   - AI classifies each column as measure/dimension/time/key
   - AI suggests display names for cryptic headers
   - AI identifies potential relationships with existing datasets
4. Mapping proposal stored as `mapping_config` JSON on the dataset record
5. Dataset status updated to `status: "mapped_pending_review"`

### Stage 5: User Review & Confirmation

**Runs in:** Frontend (interactive)

**What happens:**
1. UI shows the AI's mapping proposal with confidence indicators
2. User can accept, modify, or reject individual column mappings
3. For financial data: user confirms account hierarchy assignments
4. User tags the upload as "actuals", "budget", or "forecast" (sets `data_layer`)
5. On confirmation, API triggers the materialization job

**Shortcut for repeat formats:** If the same ERP export format has been mapped before (matched by column name fingerprint), the system auto-applies the cached mapping and skips to materialization. User sees a "Recognized format — using previous mapping" notification with an option to review.

### Stage 6: Materialize to Parquet

**Runs in:** ARQ worker, after user confirmation

**What happens:**
1. Worker reads the parsed data (still in raw form from Stage 2)
2. Applies the confirmed column mapping:
   - Renames columns to canonical names
   - Casts types (numeric coercion, date normalization to ISO)
   - Generates surrogate keys for dimension lookups
   - Adds `data_layer`, `source_key`, and `row_id` columns
3. **Dimension extraction:**
   - If upload contains a chart of accounts sheet → populates/updates `dim_account`
   - If new cost centers or entities found → extends `dim_cost_center` / `dim_entity`
   - Dimensions stored as separate Parquet files
4. Fact data written as Parquet: `processed/{model_id}/{dataset_id}/data.parquet`
5. DuckDB views registered for the new dataset
6. Dataset status updated to `status: "active"`
7. PostgreSQL column catalog updated with final canonical names

### Stage 7: Post-Processing

**Runs in:** ARQ worker, after materialization

**What happens:**
1. **Auto-link calendar dimension** — time columns joined to `dim_date`
2. **Semantic layer population:**
   - Value labels from dimension tables (account code → account name)
   - Column descriptions from AI reasoning
   - Synonym lists for the glossary
3. **KPI activation** — if `financial_transactions` fact type and `dim_account` has P&L hierarchy, pre-built financial KPIs become available
4. **Knowledge seeding** — AI generates initial Knowledge entries about the dataset structure
5. Frontend notified via WebSocket or polling that processing is complete

## Error Handling

Each stage is idempotent and individually retryable:

- **Parse failure:** Dataset marked `status: "parse_error"`, user shown error with option to re-upload
- **AI classification timeout:** Falls back to heuristic-only classification, dataset still usable
- **Materialization failure:** Raw file preserved in Blob, user can retry after fixing mapping
- **Partial multi-sheet failure:** Successfully parsed sheets are materialized; failed sheets are flagged individually

## File Format Support

| Format | Engine | Notes |
|--------|--------|-------|
| .xlsx | calamine (Rust) | Primary path — 10–50x faster than openpyxl |
| .xls | calamine | Legacy Excel format |
| .xlsm | calamine | Macro-enabled workbooks (macros ignored) |
| .csv | Polars native | Auto-detects separator (comma, semicolon, tab, pipe) |
| .tsv | Polars native | Tab-separated |

## Blob Storage Layout

```
az://databobiq-data/
├── raw/
│   └── {model_id}/
│       └── {upload_id}/
│           └── original_filename.xlsx     # Immutable raw upload
├── processed/
│   └── {model_id}/
│       ├── {dataset_id}/
│       │   └── data.parquet               # Canonical fact data
│       └── dimensions/
│           ├── dim_date.parquet            # Shared calendar
│           ├── dim_account.parquet         # Chart of accounts
│           ├── dim_cost_center.parquet     # Cost centers
│           └── dim_entity.parquet          # Legal entities
└── scenarios/
    └── {model_id}/
        └── {scenario_id}/
            └── overrides.parquet           # Delta overlay
```
