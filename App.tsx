
import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { Loader } from './components/Loader';
import { supabase } from './services/supabaseClient';
import type { AnalysisResults } from './types';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { LogoutButton } from './components/LoginButton';
import { EditPage } from './pages/EditPage';
import { StatsPage } from './pages/StatsPage';
import { RecentProblemsPage } from './pages/RecentProblemsPage';
import { AnalyzingPage } from './pages/AnalyzingPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

const App: React.FC = () => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResults | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    setAnalysisResult(null);
    setSessionId(null);
    setError(null);
  };

  const fileToBase64 = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const [header, data] = result.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'application/octet-stream';
        resolve({ base64: data, mimeType });
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const navigate = useNavigate();

  const handleAnalyzeClick = useCallback(async () => {
    if (!imageFile) {
      setError('분석할 이미지를 먼저 업로드해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 현재 사용자 가져오기
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError('로그인이 필요합니다.');
        setIsLoading(false);
        return;
      }

      // 환경 변수 확인
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError('환경 변수가 설정되지 않았습니다.');
        setIsLoading(false);
        return;
      }

      // 1. Edge Function 호출 (이미지 업로드, 세션 생성, 분석을 모두 처리)
      console.log('1. Starting image upload and analysis...');
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-image`;
      
      // 이미지를 base64로 변환
      const { base64, mimeType } = await fileToBase64(imageFile);
      
      // 이미지 업로드 버튼을 누르는 즉시 성공 메시지 표시
      setIsLoading(false);
      alert('업로드 완료. AI 분석이 진행중입니다. 앱에서 나가도 좋습니다.');
      
      // Edge Function 호출 (Supabase 클라이언트 사용)
      console.log('Attempting to call Edge Function via Supabase client');
      
      supabase.functions.invoke('analyze-image', {
        body: {
          imageBase64: base64,
          mimeType,
          userId: userData.user.id,
          fileName: imageFile.name,
        }
      }).then(({ data, error }) => {
        if (error) {
          console.error('Supabase Edge Function error:', error);
        } else {
          console.log('Session created:', data);
        }
      }).catch((error) => {
        console.error('Supabase client error:', error);
      });
      
      // Edge Function 호출 후 /recent로 이동 (새로고침 포함)
      window.location.href = '/recent';
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다. 다시 시도해주세요.');
      setIsLoading(false);
    }
  }, [imageFile, navigate]);

  return (
    <div className="min-h-screen font-sans">
      <Header />
      <nav className="container mx-auto px-4 md:px-8 py-3 flex gap-3 items-center text-sm text-slate-600">
        <Link to="/upload" className="hover:text-indigo-600">풀이한 문제 올리기</Link>
        <Link to="/recent" className="hover:text-indigo-600">최근 업로드된 문제</Link>
        <Link to="/stats" className="hover:text-indigo-600">통계</Link>
        <div className="ml-auto"><LogoutButton /></div>
      </nav>
      <main className="container mx-auto p-4 md:p-8">
        <Routes>
          <Route path="/upload" element={
            <AuthGate>
              <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    📸 문제 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다.
                    AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.
                  </p>
                </div>
                <ImageUploader onImageSelect={handleImageSelect} />
                <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalyzeClick}
                    disabled={!imageFile || isLoading}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    {isLoading ? '업로드 중...' : '이미지 업로드'}
                  </button>
                </div>
                {isLoading && <Loader />}
                {error && (
                  <div className="mt-6 p-4 bg-red-100 border border-red-300 text-red-800 rounded-lg text-center">
                    <p className="font-semibold">오류 발생</p>
                    <p>{error}</p>
                  </div>
                )}
              </div>
            </AuthGate>
          } />
          <Route path="/edit/:sessionId" element={<AuthGate><EditPage /></AuthGate>} />
          <Route path="/analyzing/:sessionId" element={<AuthGate><AnalyzingPage /></AuthGate>} />
          <Route path="/session/:sessionId" element={<AuthGate><SessionDetailPage /></AuthGate>} />
          <Route path="/recent" element={<AuthGate><RecentProblemsPage /></AuthGate>} />
          <Route path="/stats" element={<AuthGate><StatsPage /></AuthGate>} />
          <Route path="/" element={<AuthGate><div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    📸 문제 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다.
                    AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.
                  </p>
                </div>
                <ImageUploader onImageSelect={handleImageSelect} />
                <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalyzeClick}
                    disabled={!imageFile || isLoading}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    {isLoading ? '업로드 중...' : '이미지 업로드'}
                  </button>
                </div>
                {isLoading && <Loader />}
                {error && (
                  <div className="mt-6 p-4 bg-red-100 border border-red-300 text-red-800 rounded-lg text-center">
                    <p className="font-semibold">오류 발생</p>
                    <p>{error}</p>
                  </div>
                )}
              </div></AuthGate>} />
          <Route path="*" element={<AuthGate><div className="text-center py-10"><a href="/upload" className="text-indigo-600 underline">문제 업로드하러 가기</a></div></AuthGate>} />
        </Routes>
      </main>
      <footer className="text-center py-6 text-slate-500 text-sm">
        <p>Powered by Google Gemini API</p>
      </footer>
    </div>
  );
};

export default App;
