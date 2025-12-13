import React from 'react';
import { TopBar } from './TopBar';

interface PageLayoutProps {
  children: React.ReactNode;
}

export const PageLayout: React.FC<PageLayoutProps> = ({ children }) => {
  return (
    <div className="page-shell" style={{ paddingTop: '1rem', overflowX: 'hidden', width: '100%', maxWidth: '100%' }}>
      <TopBar />
      <div style={{ marginTop: '1rem', width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
        {children}
      </div>
    </div>
  );
};

