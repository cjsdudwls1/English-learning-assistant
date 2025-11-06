
import React, { useState, useCallback } from 'react';
import { Header } from './components/Header';
import { ImageUploader } from './components/ImageUploader';
import { Loader } from './components/Loader';
import { supabase } from './services/supabaseClient';
import { Routes, Route, Link } from 'react-router-dom';
import { AuthGate } from './components/AuthGate';
import { LogoutButton } from './components/LoginButton';
import { EditPage } from './pages/EditPage';
import { StatsPage } from './pages/StatsPage';
import { RecentProblemsPage } from './pages/RecentProblemsPage';
import { AnalyzingPage } from './pages/AnalyzingPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { RetryProblemsPage } from './pages/RetryProblemsPage';
import { ProfilePage } from './pages/ProfilePage';
import { useLanguage } from './contexts/LanguageContext';
import { getTranslation } from './utils/translations';

const App: React.FC = () => {
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleImagesSelect = (files: File[]) => {
    setImageFiles(files);
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
    if (imageFiles.length === 0) {
      setError(language === 'ko' ? '분석할 이미지를 먼저 업로드해주세요.' : 'Please upload an image to analyze first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 현재 사용자 가져오기
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
        setIsLoading(false);
        return;
      }
      
      // 사용자 언어 설정 가져오기
      const currentLanguage = language;

      // 환경 변수 확인
      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError(language === 'ko' ? '환경 변수가 설정되지 않았습니다.' : 'Environment variables are not set.');
        setIsLoading(false);
        return;
      }

      // 여러 이미지를 순차적으로 업로드
      console.log(`Starting upload and analysis for ${imageFiles.length} images...`);
      const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-image`;
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;

      // 이미지 업로드 버튼을 누르는 즉시 성공 메시지 표시
      setIsLoading(false);
      const uploadMessage = language === 'ko' 
        ? `${imageFiles.length}개 이미지 업로드 완료. AI 분석이 진행중입니다. 앱에서 나가도 좋습니다.`
        : `${imageFiles.length} image(s) uploaded. AI analysis is in progress. You can leave the app.`;
      alert(uploadMessage);
      
      // 모든 이미지를 백그라운드에서 업로드
      const uploadPromises = imageFiles.map(async (file) => {
        try {
          const { base64, mimeType } = await fileToBase64(file);
          
          const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              imageBase64: base64,
              mimeType,
              userId: userData.user.id,
              fileName: file.name,
              language: currentLanguage,
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            console.log('Session created for', file.name, ':', result);
            return result;
          } else {
            console.error('Edge Function error for', file.name, ':', response.status, await response.text());
            return null;
          }
        } catch (fetchError) {
          console.error('Fetch error for', file.name, ':', fetchError);
          return null;
        }
      });

      // 모든 업로드 완료 대기 (에러가 나도 계속 진행)
      await Promise.all(uploadPromises);
      
      // Edge Function 호출 후 /stats로 이동 (새로고침 포함)
      window.location.href = '/stats';
    } catch (err) {
      console.error(err);
      const errorMessage = language === 'ko' 
        ? '업로드 중 오류가 발생했습니다. 다시 시도해주세요.'
        : 'An error occurred during upload. Please try again.';
      setError(err instanceof Error ? err.message : errorMessage);
      setIsLoading(false);
    }
  }, [imageFiles, language]);

  return (
    <div className="min-h-screen font-sans bg-white dark:bg-slate-900">
      <Header />
      <nav className="container mx-auto px-4 md:px-8 py-3 flex gap-3 items-center text-sm text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <Link to="/upload" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">{t.header.upload}</Link>
        {/* <Link to="/recent" className="hover:text-indigo-600 dark:hover:text-indigo-400">최근 업로드된 문제</Link> - 내부 검증용으로만 사용 */}
        <Link to="/stats" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">{t.header.stats}</Link>
        <Link to="/profile" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">{t.header.profile}</Link>
        <div className="ml-auto"><LogoutButton /></div>
      </nav>
      <main className="container mx-auto p-4 md:p-8">
        <Routes>
          <Route path="/upload" element={
            <AuthGate>
              <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    {language === 'ko' 
                      ? '📸 문제 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다. AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.'
                      : '📸 When you upload a problem image, you will immediately see an "Uploaded!" message. AI analysis runs in the background, and you can check the results on the statistics page.'}
                  </p>
                </div>
                <ImageUploader onImagesSelect={handleImagesSelect} />
                <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalyzeClick}
                    disabled={imageFiles.length === 0 || isLoading}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    {isLoading ? t.upload.uploading : `${t.upload.uploadButton} (${imageFiles.length}${t.upload.uploadCount})`}
                  </button>
                </div>
                {isLoading && <Loader />}
                {error && (
                  <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg text-center">
                    <p className="font-semibold">{t.common.error}</p>
                    <p>{error}</p>
                  </div>
                )}
              </div>
            </AuthGate>
          } />
          <Route path="/edit/:sessionId" element={<AuthGate><EditPage /></AuthGate>} />
          <Route path="/analyzing/:sessionId" element={<AuthGate><AnalyzingPage /></AuthGate>} />
          <Route path="/session/:sessionId" element={<AuthGate><SessionDetailPage /></AuthGate>} />
          <Route path="/retry" element={<AuthGate><RetryProblemsPage /></AuthGate>} />
          <Route path="/recent" element={<AuthGate><RecentProblemsPage /></AuthGate>} />
          <Route path="/stats" element={<AuthGate><StatsPage /></AuthGate>} />
          <Route path="/profile" element={<AuthGate><ProfilePage /></AuthGate>} />
          <Route path="/" element={<AuthGate><div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    {language === 'ko' 
                      ? '📸 문제 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다. AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.'
                      : '📸 When you upload a problem image, you will immediately see an "Uploaded!" message. AI analysis runs in the background, and you can check the results on the statistics page.'}
                  </p>
                </div>
                <ImageUploader onImagesSelect={handleImagesSelect} />
                <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalyzeClick}
                    disabled={imageFiles.length === 0 || isLoading}
                    className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-lg shadow-md hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    {isLoading ? t.upload.uploading : `${t.upload.uploadButton} (${imageFiles.length}${t.upload.uploadCount})`}
                  </button>
                </div>
                {isLoading && <Loader />}
                {error && (
                  <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg text-center">
                    <p className="font-semibold">{t.common.error}</p>
                    <p>{error}</p>
                  </div>
                )}
              </div></AuthGate>} />
          <Route path="*" element={<AuthGate><div className="text-center py-10"><a href="/upload" className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 dark:hover:text-indigo-300">{language === 'ko' ? '문제 업로드하러 가기' : 'Go to Upload'}</a></div></AuthGate>} />
        </Routes>
      </main>
      <footer className="text-center py-6 text-slate-500 dark:text-slate-400 text-sm bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
        <p>고객지원: <a href="mailto:mearidj@gmail.com" className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline">mearidj@gmail.com</a></p>
      </footer>
    </div>
  );
};

export default App;
