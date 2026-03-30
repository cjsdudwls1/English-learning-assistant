import React from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { LogoutButton } from './LoginButton';
import { useLanguage } from '../contexts/LanguageContext';
import { useUserRole } from '../contexts/UserRoleContext';

export type Status = 'idle' | 'loading' | 'done' | 'error';

interface TopBarProps {
  status?: Status;
}

export const TopBar: React.FC<TopBarProps> = ({ status = 'idle' }) => {
  const { language } = useLanguage();
  const { role } = useUserRole();

  return (
    <header className="topbar">
      <div className="brand">
        AI<span>영어</span><span>문제</span><span>분석기</span>
      </div>
      <nav>
        {role === 'student' && (
          <>
            <Link to="/upload" data-discover="true">업로드</Link>
            <Link to="/stats" data-discover="true">통계</Link>
            <Link to="/problems" data-discover="true">문제 관리</Link>
            <Link to="/assignments" data-discover="true">과제</Link>
          </>
        )}
        {role === 'teacher' && (
          <>
            <Link to="/upload" data-discover="true">업로드</Link>
            <Link to="/teacher/dashboard" data-discover="true">학급 관리</Link>
            <Link to="/teacher/assignments/create" data-discover="true">과제 만들기</Link>
            <Link to="/stats" data-discover="true">통계</Link>
          </>
        )}
        {role === 'parent' && (
          <>
            <Link to="/parent/dashboard" data-discover="true">자녀 현황</Link>
          </>
        )}
        {role === 'director' && (
          <>
            <Link to="/director/dashboard" data-discover="true">학원 관리</Link>
          </>
        )}
        <Link to="/profile" data-discover="true">프로필</Link>
      </nav>
      <div className="top-actions">
        <LanguageToggle />
        <ThemeToggle />
        <LogoutButton />
        <span className={`status-chip status-${status}`}>
          {status === 'idle' && (language === 'ko' ? '대기 중' : 'Idle')}
          {status === 'loading' && (language === 'ko' ? '분석 중' : 'Analyzing')}
          {status === 'done' && (language === 'ko' ? '완료' : 'Done')}
          {status === 'error' && (language === 'ko' ? '오류' : 'Error')}
        </span>
      </div>
    </header>
  );
};
