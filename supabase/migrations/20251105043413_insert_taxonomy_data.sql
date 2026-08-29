-- Migration: Insert taxonomy data from CSV files
-- This migration inserts all taxonomy data from edge_function_taxonomy_en_v3.csv and Sheet1.csv

DELETE FROM taxonomy;

-- Batch 1: First 20 rows
INSERT INTO taxonomy (code, depth1_en, depth2_en, depth3_en, depth4_en, label_en, depth1, depth2, depth3, depth4, cefr, difficulty, tags, vocabulary_level, age_correspondence, cefr_lex, academic_vocab_index, frequency_index, ngsl_rank, definition_ko, error_signals_ko, example_wrong, example_correct, related_rules, definition_en, core_rule_en, core_rule_ko, error_signals_en, llm_hints) VALUES 
('TNS.ASP.PRS.PROG', 'Tense & Aspect', 'Tense & Aspect', 'Present', 'Present Progressive', 'Present ? Present Progressive', '문장 형태·시제·상', '시제 & 상', '현재시제', '현재진행', 'A1', 1, ARRAY['시제', '진행'], NULL, NULL, NULL, NULL, NULL, NULL, '말하는 순간 진행 중인 동작', 'now/currently와 단순현재 충돌', '*He works now.*', 'He is working now.', 'be + V-ing', NULL, NULL, NULL, NULL, NULL),
('TNS.ASP.PRS.PRF', 'Tense & Aspect', 'Tense & Aspect', 'Present', 'Present Perfect', 'Present ? Present Perfect', '문장 형태·시제·상', '시제 & 상', '현재시제', '현재완료', 'B1', 2, ARRAY['시제', '완료'], NULL, NULL, NULL, NULL, NULL, NULL, '과거 시작 지속/완료 상태', 'for/since와 단순과거 충돌', '*I lived here for 5 years.*', 'I have lived here for 5 years.', 'have/has + p.p.', NULL, NULL, NULL, NULL, NULL);
;
