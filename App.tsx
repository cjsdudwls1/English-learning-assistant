
import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { AnalysisResultDisplay } from './components/AnalysisResultDisplay';
import { Loader } from './components/Loader';
import { analyzeEnglishProblemImage } from './services/geminiService';
import type { AnalysisResult } from './types';

const App: React.FC = () => {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    setAnalysisResult(null);
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

  const handleAnalyzeClick = useCallback(async () => {
    if (!imageFile) {
      setError('분석할 이미지를 먼저 업로드해주세요.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    try {
      const { base64, mimeType } = await fileToBase64(imageFile);
      const result = await analyzeEnglishProblemImage(base64, mimeType);
      setAnalysisResult(result);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }, [imageFile]);

  return (
    <div className="min-h-screen font-sans">
      <Header />
      <main className="container mx-auto p-4 md:p-8">
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
          
          {analysisResult && <AnalysisResultDisplay result={analysisResult} />}
        </div>
      </main>
      <footer className="text-center py-6 text-slate-500 text-sm">
        <p>Powered by Google Gemini API</p>
      </footer>
    </div>
  );
};

export default App;
