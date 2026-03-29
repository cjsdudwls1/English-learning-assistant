import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import type { UserRole } from '../types';

interface UserRoleState {
  role: UserRole;
  loading: boolean;
  refreshRole: () => Promise<void>;
}

const UserRoleContext = createContext<UserRoleState>({
  role: 'student',
  loading: true,
  refreshRole: async () => {},
});

export const UserRoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [role, setRole] = useState<UserRole>('student');
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    let mounted = true;
    const fetchRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) { setRole('student'); setLoading(false); return; }

      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();

      if (mounted) {
        const r = data?.role as UserRole;
        setRole(r && ['student', 'teacher', 'parent', 'director'].includes(r) ? r : 'student');
        setLoading(false);
      }
    };
    fetchRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (mounted) fetchRole();
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  return (
    <UserRoleContext.Provider value={{ role, loading, refreshRole: loadRole }}>
      {children}
    </UserRoleContext.Provider>
  );
};

export const useUserRole = () => useContext(UserRoleContext);
