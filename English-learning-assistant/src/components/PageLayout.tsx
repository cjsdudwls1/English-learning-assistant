import React from 'react';
import { TopBar } from './TopBar';

interface PageLayoutProps {
  children: React.ReactNode;
}

export const PageLayout: React.FC<PageLayoutProps> = ({ children }) => {
  return (
    <div className="page-shell page-shell--app">
      <TopBar />
      <div className="page-body">
        {children}
      </div>
    </div>
  );
};

