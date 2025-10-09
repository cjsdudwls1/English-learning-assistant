
import React from 'react';

export const Loader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center my-8">
      <div className="w-12 h-12 border-4 border-t-indigo-600 border-slate-200 rounded-full animate-spin"></div>
      <p className="mt-4 text-slate-600 font-semibold">AI가 이미지를 분석하고 있습니다. 잠시만 기다려주세요...</p>
    </div>
  );
};
