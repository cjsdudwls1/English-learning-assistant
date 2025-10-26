import React from 'react';

interface AnalyzingCardProps {
  sessionId: string;
  imageUrl: string;
}

export const AnalyzingCard: React.FC<AnalyzingCardProps> = ({ 
  imageUrl 
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 mb-6">
      <div className="flex items-start gap-6">
        {/* 이미지 썸네일 */}
        <img 
          src={imageUrl} 
          alt="문제 이미지" 
          className="w-24 h-24 object-cover rounded border flex-shrink-0"
        />
        
        {/* 분석 중 메시지 */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            <h3 className="text-xl font-bold text-slate-800">AI 분석 중...</h3>
          </div>
          <p className="text-slate-600">
            이미지를 분석하고 있습니다. 잠시만 기다려주세요.
          </p>
        </div>
      </div>
    </div>
  );
};
