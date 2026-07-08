// Re-export all functions from sub-modules for backward compatibility
export { getCurrentUserId } from './db/auth';
export { uploadProblemImage } from './db/storage';
export { findTaxonomyByDepth, fetchTaxonomyByCode, fetchAllTaxonomy } from './db/taxonomy';

// Sessions
export {
  fetchUserSessions,
  fetchSessionsByStatus,
  fetchAnalyzingSessions,
  fetchFailedSessions,
  fetchPendingLabelingSessions,
  deleteSession,
  getSessionStatus,
  getSessionProgress,
} from './db/sessions';

// Problems
export {
  fetchSessionProblems,
  fetchProblemsByIds,
  fetchProblemsByClassification,
  fetchProblemsForLabeling,
  updateProblemLabels,
  deleteProblems,
} from './db/problems';

// Labels
export {
  quickUpdateLabels,
} from './db/labels';

// Reports
export {
  saveProblemReport,
  fetchProblemReport,
} from './db/reports';

// Problem Solving
export {
  startProblemSolving,
  completeProblemSolving,
  getProblemSolvingSession,
  saveGeneratedProblemResults,
  type GeneratedProblemResult,
} from './db/problemSolving';

// Retry Attempts (등록 문제 재풀이 이력)
export {
  saveRetryAttempts,
  fetchRetryAttempts,
  type RetryAttempt,
  type RetryAttemptInput,
} from './db/retryAttempts';

// Metadata
export {
  fetchProblemsMetadataByCorrectness,
  type ProblemMetadataItem,
} from './db/metadata';

// Classes
export {
  createClass,
  fetchAllClasses,
  fetchMyClasses,
  fetchClassMembers,
  addClassMember,
  removeClassMember,
  deleteClass,
} from './db/classes';

// Assignments
export {
  createAssignment,
  fetchMyAssignments,
  fetchAssignedToMe,
  fetchChildAssignments,
  submitAssignmentResponse,
  fetchAssignmentResponses,
  gradeAssignmentResponse,
  fetchAssignmentProblems,
  deleteAssignment,
} from './db/assignments';

// Parent-Children
export {
  linkChild,
  fetchMyChildren,
  unlinkChild,
  type ChildInfo,
} from './db/parentChildren';

// Role Stats
export {
  fetchMonthlySolvingStats,
  fetchDailySolvingStats,
  fetchWeeklySolvingSummary,
  fetchClassAssignmentStats,
  fetchDirectorOverview,
  type DirectorOverview,
  type WeeklySolvingSummary,
} from './db/roleStats';

// Teacher Stats
export {
  fetchTeacherPerformances,
  type TeacherPerformance,
} from './db/teacherStats';

// Academies
export {
  fetchMyAcademies,
  fetchAcademyById,
  createAcademy,
  fetchAcademyMembers,
  addAcademyMember,
  removeAcademyMember,
  searchUserByEmail,
  fetchAcademyHierarchy,
  type AcademyMembership,
  type AcademyMember,
} from './db/academies';

// Consulting
export {
  saveConsultingReport,
  fetchConsultingReports,
  deleteConsultingReport,
  type ConsultingReportRow,
} from './db/consulting';
