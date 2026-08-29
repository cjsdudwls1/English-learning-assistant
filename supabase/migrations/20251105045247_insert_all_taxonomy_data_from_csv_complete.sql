-- Migration: Insert all 109 taxonomy records from CSV files
-- This includes data from both edge_function_taxonomy_en_v3.csv and Sheet1.csv
-- Sheet1.csv fields: definition_en, core_rule_en, core_rule_ko, error_signals_en, llm_hints

DELETE FROM taxonomy;;
