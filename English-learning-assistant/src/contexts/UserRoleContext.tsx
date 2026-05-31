import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { fetchMyAcademies, type AcademyMembership } from '../services/db/academies';
import type { UserRole } from '../types';

interface UserRoleState {
  role: UserRole;
  loading: boolean;
  refreshRole: () => Promise<void>;
  activeAcademyId: string | null;
  availableAcademies: AcademyMembership[];
  setActiveAcademy: (academyId: string | null) => void;
}

const UserRoleContext = createContext<UserRoleState>({
  role: 'student',
  loading: true,
  refreshRole: async () => {},
  activeAcademyId: null,
  availableAcademies: [],
  setActiveAcademy: () => {},
});

function getStorageKey(userId: string) {
  return `edu-active-academy-${userId}`;
}

export const UserRoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(true);
  const [activeAcademyId, setActiveAcademyIdState] = useState<string | null>(null);
  const [availableAcademies, setAvailableAcademies] = useState<AcademyMembership[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const loadRole = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    const r = data?.role as UserRole;
    setRole(r && ['student', 'teacher', 'parent', 'director'].includes(r) ? r : 'student');
    setLoading(false);
  };

  const loadAcademies = async (userId: string) => {
    try {
      const academies = await fetchMyAcademies(userId);
      setAvailableAcademies(academies);

      const stored = localStorage.getItem(getStorageKey(userId));
      if (stored && academies.some(a => a.id === stored)) {
        setActiveAcademyIdState(stored);
      } else if (academies.length > 0) {
        setActiveAcademyIdState(academies[0].id);
        localStorage.setItem(getStorageKey(userId), academies[0].id);
      } else {
        setActiveAcademyIdState(null);
      }
    } catch {
      setAvailableAcademies([]);
    }
  };

  useEffect(() => {
    let mounted = true;
    const fetchRole = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!mounted) return;
      if (!user) { setLoading(false); return; }

      setCurrentUserId(user.id);

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!mounted) return;
      const r = data?.role as UserRole;
      if (r && ['student', 'teacher', 'parent', 'director'].includes(r)) {
        setRole(r);
      }
      setLoading(false);

      await loadAcademies(user.id);
    };
    fetchRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') {
        setRole('student');
        setAvailableAcademies([]);
        setActiveAcademyIdState(null);
        setCurrentUserId(null);
        setLoading(false);
        return;
      }
      if (session?.user) {
        fetchRole();
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const setActiveAcademy = (academyId: string | null) => {
    setActiveAcademyIdState(academyId);
    if (currentUserId) {
      if (academyId) {
        localStorage.setItem(getStorageKey(currentUserId), academyId);
      } else {
        localStorage.removeItem(getStorageKey(currentUserId));
      }
    }
  };

  return (
    <UserRoleContext.Provider value={{
      role,
      loading,
      refreshRole: loadRole,
      activeAcademyId,
      availableAcademies,
      setActiveAcademy,
    }}>
      {children}
    </UserRoleContext.Provider>
  );
};

export const useUserRole = () => useContext(UserRoleContext);
