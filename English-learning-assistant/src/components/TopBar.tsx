import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
  const navRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();

  // 현재 페이지 표시. 정확 일치만 쓴다.
  // 접두사 매칭을 하면 /teacher/assignments/create 같은 형제 경로끼리 서로 잡아먹는다.
  // 예외는 하나뿐 — App.tsx에서 '/'와 '/upload'가 같은 mainPageElement를 렌더하므로
  // '/'에 있을 때도 '업로드' 탭이 켜져야 한다.
  const path = pathname.replace(/\/+$/, '') || '/';
  const current = path === '/' ? '/upload' : path;
  const cur = (to: string): 'page' | undefined => (current === to ? 'page' : undefined);

  // 탭바를 가로 스크롤 한 줄로 바꾸면서 활성 탭이 화면 밖에 있을 수 있다.
  // 마운트/경로 변경 시 활성 탭을 스크롤 범위 안으로 끌어온다.
  // - block:'nearest'를 빼면 페이지 전체가 세로로 튄다.
  // - behavior는 지정하지 않는다(기본 auto). smooth면 라우팅마다 탭바가 미끄러져 산만하다.
  // - 데스크톱은 nav가 넘치지 않으므로 아무 일도 일어나지 않는다.
  // - role이 나중에 채워지면 탭 구성이 통째로 바뀌므로 deps에 포함한다.
  // - 활성 링크를 querySelector로 찾는다. 링크마다 ref를 다는 것과 결과는 같은데
  //   조건부 ref를 11곳에 중복시키지 않아도 되고, role 분기가 바뀌어도 안 깨진다.
  // - jsdom엔 scrollIntoView가 없어 옵셔널 호출로 방어한다.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('a[aria-current="page"]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [current, role]);

  return (
    <header className="topbar">
      <div className="brand">
        AI<span>{t.app.brandEnglish}</span><span>{t.app.brandProblem}</span><span>{t.app.brandAnalyzer}</span>
      </div>
      <nav ref={navRef}>
        {role === 'student' && (
          <>
            <Link to="/upload" data-discover="true" aria-current={cur('/upload')}>{t.header.upload}</Link>
            <Link to="/stats" data-discover="true" aria-current={cur('/stats')}>{t.header.stats}</Link>
            <Link to="/problems" data-discover="true" aria-current={cur('/problems')}>{t.header.problemManagement}</Link>
            <Link to="/assignments" data-discover="true" aria-current={cur('/assignments')}>{t.header.assignments}</Link>
          </>
        )}
        {role === 'teacher' && (
          <>
            <Link to="/upload" data-discover="true" aria-current={cur('/upload')}>{t.header.upload}</Link>
            <Link to="/teacher/dashboard" data-discover="true" aria-current={cur('/teacher/dashboard')}>{t.header.classManagement}</Link>
            <Link to="/teacher/assignments/create" data-discover="true" aria-current={cur('/teacher/assignments/create')}>{t.header.createAssignment}</Link>
            <Link to="/stats" data-discover="true" aria-current={cur('/stats')}>{t.header.stats}</Link>
          </>
        )}
        {role === 'parent' && (
          <>
            <Link to="/parent/dashboard" data-discover="true" aria-current={cur('/parent/dashboard')}>{t.header.childStatus}</Link>
          </>
        )}
        {/* 원장은 RoleGate가 허용한 경로가 여럿인데 링크가 대시보드 하나뿐이라
            나머지는 주소창에 직접 쳐야만 도달할 수 있었다. 라벨은 목적지 화면의
            제목을 그대로 쓴다 — '학원 관리'(대시보드)와 '내 학원'(/academies)은
            서로 다른 화면이므로 t.header.academyManagement를 재사용하지 않는다. */}
        {role === 'director' && (
          <>
            <Link to="/director/dashboard" data-discover="true" aria-current={cur('/director/dashboard')}>{t.header.academyManagement}</Link>
            <Link to="/academies" data-discover="true" aria-current={cur('/academies')}>{t.academy.myAcademies}</Link>
            <Link to="/teacher/assignments/create" data-discover="true" aria-current={cur('/teacher/assignments/create')}>{t.header.createAssignment}</Link>
            <Link to="/stats" data-discover="true" aria-current={cur('/stats')}>{t.header.stats}</Link>
          </>
        )}
        <Link to="/profile" data-discover="true" aria-current={cur('/profile')}>{t.header.profile}</Link>
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
