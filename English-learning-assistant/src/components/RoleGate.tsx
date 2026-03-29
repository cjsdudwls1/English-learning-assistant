import React from 'react';
import { Navigate } from 'react-router-dom';
import { useUserRole } from '../contexts/UserRoleContext';
import type { UserRole } from '../types';

interface RoleGateProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

const ROLE_HOME: Record<UserRole, string> = {
  student: '/upload',
  teacher: '/teacher/dashboard',
  parent: '/parent/dashboard',
  director: '/director/dashboard',
};

export const RoleGate: React.FC<RoleGateProps> = ({ allowedRoles, children }) => {
  const { role, loading } = useUserRole();

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

  return <>{children}</>;
};
