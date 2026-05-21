import React from 'react';
import { Navigate } from 'react-router-dom';
import { useUserRole } from '../contexts/UserRoleContext';
import type { UserRole } from '../types';

type AcademyRole = 'director' | 'teacher' | 'student';

const ACADEMY_ROLE_RANK: Record<AcademyRole, number> = {
  director: 3,
  teacher: 2,
  student: 1,
};

interface RoleGateProps {
  allowedRoles: UserRole[];
  requiredAcademyRole?: AcademyRole;
  children: React.ReactNode;
}

const ROLE_HOME: Record<UserRole, string> = {
  student: '/upload',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  director: '/director/dashboard',
};

export const RoleGate: React.FC<RoleGateProps> = ({ allowedRoles, requiredAcademyRole, children }) => {
  const { role, loading, activeAcademyId, availableAcademies } = useUserRole();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!allowedRoles.includes(role)) {
    return <Navigate to={ROLE_HOME[role]} replace />;
  }

  if (requiredAcademyRole && activeAcademyId) {
    const membership = availableAcademies.find(a => a.id === activeAcademyId);
    const userRank = membership ? ACADEMY_ROLE_RANK[membership.role] : 0;
    const requiredRank = ACADEMY_ROLE_RANK[requiredAcademyRole];
    if (userRank < requiredRank) {
      return <Navigate to={ROLE_HOME[role]} replace />;
    }
  }

  return <>{children}</>;
};
