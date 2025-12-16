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
} from './db/sessions';

// Problems
export {
  fetchSessionProblems,
  fetchProblemsByIds,
  fetchProblemsByClassification,
  fetchProblemsForLabeling,
  updateProblemLabels,
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


