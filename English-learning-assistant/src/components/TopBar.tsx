import React from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { LogoutButton } from './LoginButton';
import { useLanguage } from '../contexts/LanguageContext';
import { getTranslation } from '../utils/translations';
import { useUserRole } from '../contexts/UserRoleContext';

export type Status = 'idle' | 'loading' | 'done' | 'error';

interface TopBarProps {
  status?: Status;
}

export const TopBar: React.FC<TopBarProps> = ({ status = 'idle' }) => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const { role } = useUserRole();

  return (
    <header className="topbar">
      <div className="brand">
        AI<span>{t.app.brandEnglish}</span><span>{t.app.brandProblem}</span><span>{t.app.brandAnalyzer}</span>
      </div>
      <nav>
        {role === 'student' && (
          <>
            <Link to="/upload" data-discover="true">{t.header.upload}</Link>
            <Link to="/stats" data-discover="true">{t.header.stats}</Link>
            <Link to="/problems" data-discover="true">{t.header.problemManagement}</Link>
            <Link to="/assignments" data-discover="true">{t.header.assignments}</Link>
          </>
        )}
        {role === 'teacher' && (
          <>
            <Link to="/upload" data-discover="true">{t.header.upload}</Link>
            <Link to="/teacher/dashboard" data-discover="true">{t.header.classManagement}</Link>
            <Link to="/teacher/assignments/create" data-discover="true">{t.header.createAssignment}</Link>
            <Link to="/stats" data-discover="true">{t.header.stats}</Link>
          </>
        )}
        {role === 'parent' && (
          <>
            <Link to="/parent/dashboard" data-discover="true">{t.header.childStatus}</Link>
          </>
        )}
        {role === 'director' && (
          <>
            <Link to="/director/dashboard" data-discover="true">{t.header.academyManagement}</Link>
          </>
        )}
        <Link to="/profile" data-discover="true">{t.header.profile}</Link>
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
