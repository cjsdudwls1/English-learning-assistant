
import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { Loader } from './components/Loader';
import { analyzeEnglishProblemImage } from './services/geminiService';
import type { AnalysisResults } from './types';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { LogoutButton } from './components/LoginButton';
import { ReviewPage } from './pages/ReviewPage';
import { StatsPage } from './pages/StatsPage';

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
    setAnalysisResult(null);

    try {
      // Gemini 분석만 수행 (이미지 저장은 최종 저장 시점으로 지연)
      const { base64, mimeType } = await fileToBase64(imageFile);
      const result = await analyzeEnglishProblemImage(base64, mimeType);
      setAnalysisResult(result);
      // 검수 화면으로 이동 (이미지 파일과 결과를 state로 전달)
      navigate('/review', { state: { imageFile, results: result } });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }, [imageFile, navigate]);

  return (
    <div className="min-h-screen font-sans">
      <Header />
      <nav className="container mx-auto px-4 md:px-8 py-3 flex gap-3 items-center text-sm text-slate-600">
        <Link to="/upload" className="hover:text-indigo-600">풀이한 문제 올리기</Link>
        <Link to="/stats" className="hover:text-indigo-600">내 풀이 결과 한눈에 보기</Link>
        <div className="ml-auto"><LogoutButton /></div>
      </nav>
      <main className="container mx-auto p-4 md:p-8">
        <Routes>
          <Route path="/upload" element={
            <AuthGate>
              <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200">
                <ImageUploader onImageSelect={handleImageSelect} />
                <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalyzeClick}
                    disabled={!imageFile || isLoading}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    {isLoading ? '분석 중...' : 'AI 분석 시작하기'}
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
          <Route path="/review" element={<AuthGate><ReviewPage /></AuthGate>} />
          <Route path="/stats" element={<AuthGate><StatsPage /></AuthGate>} />
          <Route path="*" element={<AuthGate><div className="text-center text-slate-500">/upload로 이동해주세요.</div></AuthGate>} />
        </Routes>
      </main>
      <footer className="text-center py-6 text-slate-500 text-sm">
        <p>Powered by Google Gemini API</p>
      </footer>
    </div>
  );
};

export default App;
