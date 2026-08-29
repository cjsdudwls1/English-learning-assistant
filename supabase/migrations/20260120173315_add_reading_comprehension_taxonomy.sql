-- 독해 문제 유형 taxonomy 추가 (수능/모의고사 영어 독해 문제 분류)
INSERT INTO taxonomy (depth1, depth2, depth3, depth4, depth1_en, depth2_en, depth3_en, depth4_en, code, cefr, difficulty) VALUES
-- 글의 목적/주장
('독해', '목적·주장', '글의 목적', '글의 목적 파악', 'Reading', 'Purpose·Claim', 'Purpose', 'Identify Purpose', 'RD.PUR.PUR.ID', 'B1', 3),
('독해', '목적·주장', '주장', '필자 주장 파악', 'Reading', 'Purpose·Claim', 'Claim', 'Identify Claim', 'RD.PUR.CLM.ID', 'B1', 3),

-- 중심 내용
('독해', '중심 내용', '주제', '글의 주제 파악', 'Reading', 'Main Idea', 'Topic', 'Identify Topic', 'RD.MAIN.TOP.ID', 'B1', 3),
('독해', '중심 내용', '요지', '글의 요지 파악', 'Reading', 'Main Idea', 'Gist', 'Identify Gist', 'RD.MAIN.GIST.ID', 'B1', 3),
('독해', '중심 내용', '제목', '글의 제목 추론', 'Reading', 'Main Idea', 'Title', 'Infer Title', 'RD.MAIN.TITL.INF', 'B2', 4),

-- 심경/분위기
('독해', '심경·분위기', '심경', '인물 심경 파악', 'Reading', 'Mood·Atmosphere', 'Feeling', 'Identify Feeling', 'RD.MOOD.FEEL.ID', 'B1', 3),
('독해', '심경·분위기', '심경 변화', '심경 변화 파악', 'Reading', 'Mood·Atmosphere', 'Mood Change', 'Identify Mood Change', 'RD.MOOD.CHG.ID', 'B2', 4),
('독해', '심경·분위기', '분위기', '글의 분위기 파악', 'Reading', 'Mood·Atmosphere', 'Atmosphere', 'Identify Atmosphere', 'RD.MOOD.ATM.ID', 'B1', 3),

-- 세부 정보
('독해', '세부 정보', '내용 일치', '세부 내용 일치', 'Reading', 'Details', 'Content Match', 'Match Details', 'RD.DET.MATCH.Y', 'B1', 2),
('독해', '세부 정보', '내용 불일치', '세부 내용 불일치', 'Reading', 'Details', 'Content Mismatch', 'Find Mismatch', 'RD.DET.MATCH.N', 'B1', 2),
('독해', '세부 정보', '실용문 정보', '실용문 정보 파악', 'Reading', 'Details', 'Practical Info', 'Extract Info', 'RD.DET.PRAC.ID', 'B1', 2),

-- 시각 자료
('독해', '시각 자료', '도표', '도표 내용 파악', 'Reading', 'Visual', 'Chart', 'Analyze Chart', 'RD.VIS.CHRT.ID', 'B1', 3),
('독해', '시각 자료', '안내문', '안내문 정보 파악', 'Reading', 'Visual', 'Notice', 'Extract Notice Info', 'RD.VIS.NTC.ID', 'A2', 2),
('독해', '시각 자료', '광고', '광고 정보 파악', 'Reading', 'Visual', 'Ad', 'Extract Ad Info', 'RD.VIS.AD.ID', 'A2', 2),

-- 어휘/함축 의미
('독해', '어휘·함축', '어휘 의미', '밑줄 표현 의미', 'Reading', 'Vocabulary', 'Word Meaning', 'Infer Word Meaning', 'RD.VOC.MEAN.INF', 'B2', 4),
('독해', '어휘·함축', '함축 의미', '함축 의미 추론', 'Reading', 'Vocabulary', 'Implication', 'Infer Implication', 'RD.VOC.IMPL.INF', 'B2', 5),

-- 빈칸 추론
('독해', '빈칸 추론', '단어·구', '빈칸 어휘 추론', 'Reading', 'Blank Inference', 'Word·Phrase', 'Infer Word', 'RD.BLNK.WRD.INF', 'B2', 4),
('독해', '빈칸 추론', '절·문장', '빈칸 문장 추론', 'Reading', 'Blank Inference', 'Clause·Sentence', 'Infer Sentence', 'RD.BLNK.SENT.INF', 'B2', 5),
('독해', '빈칸 추론', '연결어', '빈칸 연결어 추론', 'Reading', 'Blank Inference', 'Connector', 'Infer Connector', 'RD.BLNK.CONN.INF', 'B1', 3),

-- 글의 흐름
('독해', '글의 흐름', '문장 삽입', '문장 위치 파악', 'Reading', 'Flow', 'Sentence Insertion', 'Find Position', 'RD.FLOW.INS.POS', 'B2', 4),
('독해', '글의 흐름', '순서 배열', '문단 순서 배열', 'Reading', 'Flow', 'Order', 'Arrange Order', 'RD.FLOW.ORD.ARR', 'B2', 4),
('독해', '글의 흐름', '무관한 문장', '무관한 문장 찾기', 'Reading', 'Flow', 'Irrelevant', 'Find Irrelevant', 'RD.FLOW.IRR.FND', 'B2', 4),

-- 요약/추론
('독해', '요약·추론', '요약문', '요약문 완성', 'Reading', 'Summary·Inference', 'Summary', 'Complete Summary', 'RD.SUM.COMP.ID', 'B2', 5),
('독해', '요약·추론', '추론', '내용 추론', 'Reading', 'Summary·Inference', 'Inference', 'Make Inference', 'RD.SUM.INF.ID', 'B2', 4),

-- 장문 독해
('독해', '장문', '장문 이해', '장문 종합 이해', 'Reading', 'Long Passage', 'Comprehension', 'Comprehend Long Text', 'RD.LONG.COMP.ID', 'B2', 5),
('독해', '장문', '장문 세부', '장문 세부 정보', 'Reading', 'Long Passage', 'Details', 'Long Text Details', 'RD.LONG.DET.ID', 'B2', 4);
;
