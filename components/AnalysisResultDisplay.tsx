
import React from 'react';
import type { AnalysisResult } from '../types';

interface AnalysisResultDisplayProps {
  result: AnalysisResult;
}

const InfoCard: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`bg-slate-50 border border-slate-200 rounded-lg p-4 md:p-6 ${className}`}>
    <h3 className="text-lg font-bold text-indigo-700 mb-3">{title}</h3>
    {children}
  </div>
);

const ConfidenceBadge: React.FC<{ score: number }> = ({ score }) => {
    const percentage = Math.round(score * 100);
    const colorClass = percentage > 90 ? 'bg-green-100 text-green-800' : percentage > 75 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
    return (
        <span className={`text-xs font-medium me-2 px-2.5 py-0.5 rounded ${colorClass}`}>
            신뢰도: {percentage}%
        </span>
    );
};

const GradingMark: React.FC<{ mark: string }> = ({ mark }) => {
    let content, colorClass;
    switch(mark) {
        case 'O':
            content = <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
            colorClass = 'text-green-500';
            break;
        case 'X':
            content = <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
            colorClass = 'text-red-500';
            break;
        case '△':
            content = <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
            colorClass = 'text-yellow-500';
            break;
        default:
            content = <span className="text-3xl font-bold">{mark}</span>;
            colorClass = 'text-slate-500';
    }
    return <div className={`flex items-center justify-center ${colorClass}`}>{content}</div>;
};

export const AnalysisResultDisplay: React.FC<AnalysisResultDisplayProps> = ({ result }) => {
  return (
    <div className="mt-8 space-y-6">
      <h2 className="text-2xl font-bold text-center text-slate-800 border-b pb-3">AI 분석 결과</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <InfoCard title="채점 결과" className="md:col-span-1 flex items-center justify-center">
            <GradingMark mark={result.사용자가_직접_채점한_정오답} />
        </InfoCard>
        
        <InfoCard title="사용자 답안" className="md:col-span-2">
            <p className="text-2xl font-serif font-medium text-slate-800 mb-2">{result.사용자가_기술한_정답.text}</p>
            <ConfidenceBadge score={result.사용자가_기술한_정답.confidence_score} />
            {result.사용자가_기술한_정답.auto_corrected && (
                 <span className="text-xs font-medium me-2 px-2.5 py-0.5 rounded bg-blue-100 text-blue-800">자동 교정됨</span>
            )}
            {result.사용자가_기술한_정답.alternate_interpretations?.length > 0 && (
                <div className="mt-3 text-sm text-slate-600">
                    <strong>대체 해석 가능성: </strong>
                    <span>{result.사용자가_기술한_정답.alternate_interpretations.join(', ')}</span>
                </div>
            )}
        </InfoCard>
      </div>
      
      <InfoCard title="문제 내용">
        <p className="whitespace-pre-wrap text-slate-700 leading-relaxed mb-3">{result.문제내용.text}</p>
        <ConfidenceBadge score={result.문제내용.confidence_score} />
      </InfoCard>
      
      {result.문제_보기 && result.문제_보기.length > 0 && (
          <InfoCard title="문제 보기">
              <ul className="space-y-3">
                  {result.문제_보기.map((option, index) => (
                      <li key={index} className="flex items-start justify-between">
                          <span className="text-slate-700">{option.text}</span>
                          <ConfidenceBadge score={option.confidence_score} />
                      </li>
                  ))}
              </ul>
          </InfoCard>
      )}

      <InfoCard title="문제 유형 분류">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
                <p className="text-sm text-slate-500">대분류</p>
                <p className="font-semibold text-lg">{result.문제_유형_분류['1Depth']}</p>
            </div>
            <div>
                <p className="text-sm text-slate-500">중분류</p>
                <p className="font-semibold text-lg">{result.문제_유형_분류['2Depth']}</p>
            </div>
            <div>
                <p className="text-sm text-slate-500">소분류</p>
                <p className="font-semibold text-lg">{result.문제_유형_분류['3Depth']}</p>
            </div>
            <div>
                <p className="text-sm text-slate-500">세분류</p>
                <p className="font-semibold text-lg">{result.문제_유형_분류['4Depth']}</p>
            </div>
        </div>
         <div className="mt-4 text-center">
             <span className="text-sm font-medium me-2 px-2.5 py-0.5 rounded bg-purple-100 text-purple-800">
                분류 신뢰도: {result.문제_유형_분류.분류_신뢰도}
            </span>
         </div>
      </InfoCard>

      <InfoCard title="분류 근거">
        <p className="text-slate-700">{result.분류_근거}</p>
      </InfoCard>
    </div>
  );
};
