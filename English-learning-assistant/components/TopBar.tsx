import React from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { LogoutButton } from './LoginButton';
import { useLanguage } from '../contexts/LanguageContext';

type Status = 'idle' | 'loading' | 'done' | 'error';

interface TopBarProps {
  status?: Status;
}

export const TopBar: React.FC<TopBarProps> = ({ status = 'idle' }) => {
  const { language } = useLanguage();
  
  return (
    <header className="topbar">
      <div className="brand">
        AI<span>영어</span><span>문제</span><span>분석기</span>
      </div>
      <nav>
        <Link to="/upload" data-discover="true">업로드</Link>
        <Link to="/stats" data-discover="true">통계</Link>
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

