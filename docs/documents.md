# AI 영어 문제 분석기 — 기능 명세서 & 권한 설계

## 1. 역할 정의 (RBAC)

| 역할 | 코드값 | 설명 |
|------|--------|------|
| 학생 (Student) | `student` | 문제 풀이, 과제 응답, 개인 통계 확인 |
| 선생님 (Teacher) | `teacher` | 학급 관리, 과제 출제, 학급별 학생 통계 확인 |
| 학부모 (Parent) | `parent` | 자녀 연결, 자녀 풀이+과제 통계 확인 |
| 학원장 (Director) | `director` | 전체 학원 현황, 모든 학급/학생 통계 확인 |

- 역할은 `profiles.role` 컬럼에 저장 (CHECK: `student | teacher | parent | director`)
- 미설정 시 기본값: `student`
- 한 계정에 하나의 역할만 가능

---

## 2. 페이지 구조 & 접근 권한

### 2.1 공통 페이지 (모든 인증 사용자)

| 페이지 | 경로 | 설명 |
|--------|------|------|
| 이미지 업로드 | `/upload` | 영어 시험 이미지 업로드 → AI 분석 |
| 분석 중 | `/analyzing/:sessionId` | 분석 진행 상태 표시 |
| 세션 상세 | `/session/:sessionId` | 분석 결과 및 문제 풀이 |
| 문제 편집 | `/edit/:sessionId` | 분석된 문제 편집 |
| 통계 | `/stats` | 개인 풀이 통계 (월별/일별) |
| 최근 문제 | `/recent` | 최근 풀이 문제 목록 |
| 오답 재풀이 | `/retry` | 오답 문제 재풀이 |
| 전체 문제 | `/problems` | 전체 문제 조회 |
| 프로필 설정 | `/profile` | 역할·학년 설정 |

### 2.2 학생 전용 페이지

| 페이지 | 경로 | RoleGate |
|--------|------|----------|
| 과제 목록 | `/assignments` | `['student']` |
| 과제 풀이 | `/assignments/:assignmentId` | `['student']` |

### 2.3 선생님 전용 페이지

| 페이지 | 경로 | RoleGate |
|--------|------|----------|
| 선생님 대시보드 | `/teacher/dashboard` | `['teacher', 'director']` |
| 학급 상세 | `/teacher/classes/:classId` | `['teacher', 'director']` |
| 과제 만들기 | `/teacher/assignments/create` | `['teacher', 'director']` |

### 2.4 학부모 전용 페이지

| 페이지 | 경로 | RoleGate |
|--------|------|----------|
| 학부모 대시보드 | `/parent/dashboard` | `['parent']` |

### 2.5 학원장 전용 페이지

| 페이지 | 경로 | RoleGate |
|--------|------|----------|
| 학원장 대시보드 | `/director/dashboard` | `['director']` |

---

## 3. 데이터 접근 권한 매트릭스

### 3.1 테이블별 읽기 권한

| 테이블 | 학생 | 선생님 | 학부모 | 학원장 |
|--------|------|--------|--------|--------|
| `problem_solving_sessions` | 본인 데이터 | 소속 학급 학생 | 연결된 자녀 | 전체 |
| `assignment_responses` | 본인 응답 | 본인 출제 과제의 응답 | 연결된 자녀의 응답 | 전체 |
| `classes` | 소속 학급 | 생성/소속 학급 | - | 전체 |
| `class_members` | 본인 멤버십 | 관리 학급 멤버 | - | 전체 |
| `parent_children` | 본인 자녀관계 | 전체 (조회) | 본인 자녀관계 | 전체 |
| `shared_assignments` | 대상 과제 | 본인 출제 과제 | 자녀 대상 과제 | 전체 |
| `generated_problems` | 본인 세션 문제 | 본인 세션 문제 | - | - |
| `sessions` | 본인 세션 | 본인 세션 | - | - |

### 3.2 통계 데이터 소스 정의

**핵심 원칙: 모든 통계는 `problem_solving_sessions` + `assignment_responses` 두 테이블을 합산하여 표시한다.**

| 통계 유형 | 데이터 소스 | 사용처 |
|-----------|-------------|--------|
| 학생 개인 통계 | `problem_solving_sessions(user_id=본인)` + `assignment_responses(student_id=본인)` | StatsPage > SolvingStatsCard |
| 학부모 자녀 통계 | `problem_solving_sessions(user_id=자녀)` + `assignment_responses(student_id=자녀)` | ParentDashboard > ChildStatsCard |
| 학급별 통계 | `problem_solving_sessions(user_id IN 학급학생)` + `assignment_responses(student_id IN 학급학생)` | ClassDetailPage > ClassStatsCard, DirectorDashboard |
| 학원 전체 개요 | 모든 classes, class_members, shared_assignments, assignment_responses 집계 | DirectorDashboard > AcademyOverviewCard |

---

## 4. 역할별 시나리오 & 기대 동작

### 4.1 학생 시나리오

| # | 시나리오 | 기대 동작 |
|---|----------|-----------|
| S1 | 이미지 업로드 후 문제 풀기 | session 생성 → AI 분석 → generated_problems 생성 → 문제 풀이 시 problem_solving_sessions 기록 |
| S2 | 통계 페이지에서 월별 통계 확인 | SolvingStatsCard에 연도별 총합, 12개월 버튼(데이터 있는 달 배지 표시) |
| S3 | 월 선택 후 일별 통계 확인 | 해당 월의 일별 그리드, 날짜 선택 시 해당일 상세 통계 |
| S4 | 과제 목록 확인 | assignment_targets에 본인이 포함된 과제 목록 |
| S5 | 과제 풀기 | assignment_problems의 문제 풀이 → assignment_responses에 응답 저장 |
| S6 | 오답 재풀이 | is_correct=false인 문제 재풀이 |

### 4.2 선생님 시나리오

| # | 시나리오 | 기대 동작 |
|---|----------|-----------|
| T1 | 학급 생성 | classes 테이블에 레코드 생성 (created_by = 본인) |
| T2 | 학급에 학생 추가 | 이메일로 profiles 조회 → class_members 추가 (role='student') |
| T3 | 과제 만들기 | 학급 선택 → 문제 선택(기존+AI생성) → 학생 선택 → shared_assignments + assignment_problems + assignment_targets 생성 |
| T4 | 학급 통계 확인 | ClassDetailPage에서 학급 학생들의 합산 통계 (problem_solving_sessions + assignment_responses) |
| T5 | 대시보드에서 최근 과제 확인 | 본인 출제 과제 목록 (problem_count, completed_count 표시) |

### 4.3 학부모 시나리오

| # | 시나리오 | 기대 동작 |
|---|----------|-----------|
| P1 | 자녀 연결 | 자녀 이메일로 profiles 조회 → parent_children 추가 |
| P2 | 자녀 통계 확인 | 선택한 자녀의 합산 통계 (problem_solving_sessions + assignment_responses) |
| P3 | 월별/일별 드릴다운 | 월 선택 → 일별 그리드 → 날짜 선택 시 상세 |
| P4 | 자녀 전환 | 여러 자녀 중 선택하여 통계 전환 |

### 4.4 학원장 시나리오

| # | 시나리오 | 기대 동작 |
|---|----------|-----------|
| D1 | 학원 전체 현황 | 총 학급 수, 총 학생 수, 총 과제 수, 총 응답 수, 전체 정답률 |
| D2 | 학급별 통계 확인 | 학급 선택 → 해당 학급의 합산 통계 (problem_solving_sessions + assignment_responses) |
| D3 | 선생님 기능 사용 | 선생님 대시보드 접근, 학급 생성, 과제 출제 가능 |

---

## 5. 프로필 설정 후 이동 흐름

```
ProfilePage.handleSubmit()
  ├─ profiles 테이블 upsert (email, grade, role)
  ├─ refreshRole() → UserRoleContext 갱신
  └─ navigate() 역할별 대시보드:
      ├─ student  → /upload
      ├─ teacher  → /teacher/dashboard
      ├─ parent   → /parent/dashboard
      └─ director → /director/dashboard
```

---

## 6. 에러 처리 원칙

- 통계 조회 실패 시 사용자에게 에러 메시지 표시 (빈 catch 금지)
- DB 쿼리 에러는 `setError(e.message)` 패턴으로 UI에 반영
- RLS 권한 부족 시 적절한 안내 메시지 표시
