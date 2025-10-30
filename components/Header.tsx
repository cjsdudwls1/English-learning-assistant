
import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="bg-white shadow-sm">
      <div className="container mx-auto px-4 md:px-8 py-4">
        <h1 className="text-2xl md:text-3xl font-bold text-indigo-600 whitespace-nowrap">AI 영어 문제 분석기</h1>
        <p className="text-slate-600 mt-1">손글씨로 푼 문제 이미지를 업로드하고 AI의 정밀 분석을 받아보세요.</p>
      </div>
    </header>
  );
};
