// Re-export all functions from sub-modules for backward compatibility
export { getCurrentUserId } from './db/auth';
export { uploadProblemImage } from './db/storage';
export { findTaxonomyByDepth, fetchTaxonomyByCode, fetchAllTaxonomy } from './db/taxonomy';

// Sessions
export {
  createSession,
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
} from './db/problemSolving';

// Metadata
export {
  fetchProblemsMetadataByCorrectness,
  type ProblemMetadataItem,
} from './db/metadata';

// Classes
export {
  createClass,
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
  fetchClassAssignmentStats,
  fetchDirectorOverview,
  type DirectorOverview,
} from './db/roleStats';

// Teacher Stats
export {
  fetchTeacherPerformances,
  type TeacherPerformance,
} from './db/teacherStats';
