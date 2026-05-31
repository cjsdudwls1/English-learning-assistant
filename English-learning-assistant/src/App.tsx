import React, { useState, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from './services/supabaseClient';
import { AuthGate } from './components/AuthGate';
import { PageLayout } from './components/PageLayout';
import { EditPage } from './pages/EditPage';
import { StatsPage } from './pages/StatsPage';
import { RecentProblemsPage } from './pages/RecentProblemsPage';
import { AnalyzingPage } from './pages/AnalyzingPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { RetryProblemsPage } from './pages/RetryProblemsPage';
import { AllProblemsPage } from './pages/AllProblemsPage';
import { ProfilePage } from './pages/ProfilePage';
import { TeacherDashboardPage } from './pages/TeacherDashboardPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { AssignmentSolvePage } from './pages/AssignmentSolvePage';
import { ParentDashboardPage } from './pages/ParentDashboardPage';
import { DirectorDashboardPage } from './pages/DirectorDashboardPage';
import { AcademyListPage } from './pages/AcademyListPage';
import { AcademyCreatePage } from './pages/AcademyCreatePage';
import { AcademyMembersPage } from './pages/AcademyMembersPage';
import { ClassDetailPage } from './components/teacher/ClassDetailPage';
import { AssignmentCreatePage } from './components/teacher/AssignmentCreatePage';
import { AssignmentDetailPage } from './components/teacher/AssignmentDetailPage';
import { RoleGate } from './components/RoleGate';
import { UserRoleProvider } from './contexts/UserRoleContext';
import { useLanguage } from './contexts/LanguageContext';
import { InstallBanner } from './components/InstallBanner';
import { MainPage, type ImageFile } from './pages/MainPage';
import {
  AIProviderId,
  getDefaultModelId,
  isProviderEnabled,
  loadSavedSelection,
  saveSelection,
} from './config/aiProviders';
import './styles/app.css';

const MAX_IMAGES = 10;
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Canvas API로 이미지를 리사이즈·JPEG 압축한다.
 * 긴 변 maxDimension 이하로 축소, quality 0.8 기본.
 */
function compressImage(
  file: File,
  maxDimension = 1200,
  quality = 0.8,
): Promise<{ blob: Blob; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Canvas 2D context not available'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) {
            reject(new Error(`canvas.toBlob returned null: ${file.name}`));
            return;
          }
          resolve({ blob, mimeType: 'image/jpeg' });
        }, 'image/jpeg', quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Supabase Storage `analyze-uploads` bucket에 직접 업로드.
 * RLS: `{userId}/...` 폴더 prefix가 auth.uid()와 일치해야 한다.
 */
async function uploadImageDirect(
  blob: Blob,
  userId: string,
  index: number,
  originalName: string,
): Promise<string> {
  const safeName = originalName.replace(/[^\w.-]+/g, '_').slice(0, 60);
  const path = `${userId}/${Date.now()}_${index}_${safeName}.jpg`;
  const { error } = await supabase.storage
    .from('analyze-uploads')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Upload failed (${path}): ${error.message}`);
  return path;
}

/** File[]을 ImageFile[]로 변환 (FileReader 기반 미리보기 URL 생성). */
function readFilesAsImageFiles(files: File[]): Promise<ImageFile[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<ImageFile>((resolve) => {
          const id = `${Date.now()}_${Math.random()}_${file.name}`;
          const reader = new FileReader();
          reader.onloadend = () => resolve({ file, previewUrl: reader.result as string, id });
          reader.onerror = () => resolve({ file, previewUrl: '', id });
          reader.readAsDataURL(file);
        }),
    ),
  );
}

const App: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const initialSelection = React.useMemo(() => loadSavedSelection(), []);
  const [providerId, setProviderId] = useState<AIProviderId>(initialSelection.providerId);
  const [modelId, setModelId] = useState<string>(initialSelection.modelId);
  const providerEnabled = isProviderEnabled(providerId);

  const handleProviderChange = useCallback((nextProviderId: AIProviderId) => {
    const nextModelId = getDefaultModelId(nextProviderId);
    setProviderId(nextProviderId);
    setModelId(nextModelId);
    saveSelection(nextProviderId, nextModelId);
    setError(null);
  }, []);

  const handleModelChange = useCallback((nextModelId: string) => {
    setModelId(nextModelId);
    saveSelection(providerId, nextModelId);
  }, [providerId]);

  const handleAnalyzeClick = useCallback(async () => {
    if (imageFiles.length === 0) {
      setError(language === 'ko' ? '분석할 이미지를 먼저 업로드해주세요.' : 'Please upload an image to analyze first.');
      return;
    }

    if (!isProviderEnabled(providerId)) {
      setError(language === 'ko' ? '서비스 준비중입니다.' : 'Service coming soon.');
      setStatus('error');
      return;
    }

    setIsLoading(true);
    setStatus('loading');
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(language === 'ko' ? '로그인이 필요합니다.' : 'Login required.');
        setIsLoading(false);
        setStatus('error');
        return;
      }

      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError(language === 'ko' ? '환경 변수가 설정되지 않았습니다.' : 'Environment variables are not set.');
        setIsLoading(false);
        setStatus('error');
        return;
      }

      const gcfUrl = import.meta.env.VITE_ANALYZE_GCF_URL;
      if (!userData.user?.id) {
        const errorMsg = language === 'ko' ? '사용자 ID를 가져올 수 없습니다. 다시 로그인해주세요.' : 'Cannot get user ID. Please login again.';
        setError(errorMsg);
        setIsLoading(false);
        setStatus('error');
        return;
      }

      // 압축 + Supabase Storage Direct Upload (base64 inline payload 회피)
      const imagePaths = await Promise.all(
        imageFiles.map(async (imageFile, index) => {
          const { blob } = await compressImage(imageFile.file);
          return uploadImageDirect(blob, userData.user!.id, index, imageFile.file.name);
        }),
      );

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error(language === 'ko' ? '세션이 만료되었습니다.' : 'Session expired.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

      const gcfResponse = await fetch(gcfUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          imagePaths,
          userId: userData.user.id,
          language,
          aiProvider: providerId,
          aiModel: modelId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!gcfResponse.ok) {
        const errorText = await gcfResponse.text();
        // 백엔드 503 + code='provider_unavailable' → 사용자 친화 메시지
        if (gcfResponse.status === 503) {
          try {
            const parsed = JSON.parse(errorText);
            if (parsed?.code === 'provider_unavailable') {
              throw new Error(language === 'ko' ? '서비스 준비중입니다.' : 'Service coming soon.');
            }
          } catch {
            // JSON 파싱 실패 시 원본 에러로 폴백
          }
        }
        throw new Error(`Cloud Function failed: ${gcfResponse.status} - ${errorText}`);
      }

      const gcfResult = await gcfResponse.json();
      const createdSessionId = gcfResult?.sessionId;
      if (!createdSessionId) {
        throw new Error(language === 'ko' ? '세션 생성 실패' : 'Session creation failed');
      }

      setIsLoading(false);
      setStatus('done');
      setImageFiles([]);
      navigate('/stats');
    } catch (err) {
      const fallback = language === 'ko'
        ? '업로드 중 오류가 발생했습니다. 다시 시도해주세요.'
        : 'An error occurred during upload. Please try again.';
      setError(err instanceof Error ? err.message : fallback);
      setIsLoading(false);
      setStatus('error');
    }
  }, [imageFiles, language, providerId, modelId, navigate]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const imageFilesArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFilesArray.length === 0) {
      setError(language === 'ko' ? '이미지 파일만 선택할 수 있습니다.' : 'Only image files can be selected.');
      return;
    }

    setImageFiles((prev) => {
      const remainingSlots = MAX_IMAGES - prev.length;
      if (remainingSlots <= 0) {
        setError(language === 'ko'
          ? `최대 ${MAX_IMAGES}장까지만 업로드할 수 있습니다.`
          : `You can upload up to ${MAX_IMAGES} images only.`);
        return prev;
      }

      const filesToAdd = imageFilesArray.slice(0, remainingSlots);
      if (filesToAdd.length < imageFilesArray.length) {
        setError(language === 'ko'
          ? `최대 ${MAX_IMAGES}장까지만 업로드할 수 있습니다. ${filesToAdd.length}장만 추가됩니다.`
          : `You can upload up to ${MAX_IMAGES} images only. Only ${filesToAdd.length} will be added.`);
      }

      readFilesAsImageFiles(filesToAdd).then((loaded) => {
        const valid = loaded.filter((f) => f.previewUrl);
        if (valid.length > 0) {
          setImageFiles((current) => [...current, ...valid]);
          setError(null);
        }
      });

      return prev;
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [language]);

  const handleRemove = useCallback((index: number) => {
    setImageFiles((prev) => {
      const removed = prev[index];
      if (removed && removed.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleRotate = useCallback((index: number, rotatedBlob: Blob) => {
    setImageFiles((prev) => {
      const imageFile = prev[index];
      if (!imageFile) return prev;

      const rotatedFile = new File([rotatedBlob], imageFile.file.name, {
        type: rotatedBlob.type,
        lastModified: Date.now(),
      });
      const previewUrl = URL.createObjectURL(rotatedBlob);

      if (imageFile.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageFile.previewUrl);
      }

      const updated = [...prev];
      updated[index] = { ...imageFile, file: rotatedFile, previewUrl };
      return updated;
    });
  }, []);

  const handleCameraCapture = useCallback((files: File[]) => {
    const remainingSlots = MAX_IMAGES - imageFiles.length;
    const filesToAdd = files.slice(0, remainingSlots);
    readFilesAsImageFiles(filesToAdd).then((loaded) => {
      const valid = loaded.filter((f) => f.previewUrl);
      if (valid.length > 0) setImageFiles((prev) => [...prev, ...valid]);
    });
  }, [imageFiles.length]);

  const mainPageElement = (
    <AuthGate>
      <MainPage
        imageFiles={imageFiles}
        isLoading={isLoading}
        error={error}
        status={status}
        isCameraOpen={isCameraOpen}
        providerId={providerId}
        modelId={modelId}
        providerEnabled={providerEnabled}
        onProviderChange={handleProviderChange}
        onModelChange={handleModelChange}
        onFileChange={handleFileChange}
        onAnalyzeClick={handleAnalyzeClick}
        onRemove={handleRemove}
        onRotate={handleRotate}
        onOpenCamera={() => setIsCameraOpen(true)}
        onCloseCamera={() => setIsCameraOpen(false)}
        onCameraCapture={handleCameraCapture}
        onClearAll={() => setImageFiles([])}
      />
    </AuthGate>
  );

  return (
    <UserRoleProvider>
      <Routes>
        <Route path="/" element={mainPageElement} />
        <Route path="/upload" element={mainPageElement} />
        <Route path="/edit/:sessionId" element={<AuthGate><PageLayout><EditPage /></PageLayout></AuthGate>} />
        <Route path="/analyzing/:sessionId" element={<AuthGate><PageLayout><AnalyzingPage /></PageLayout></AuthGate>} />
        <Route path="/session/:sessionId" element={<AuthGate><PageLayout><SessionDetailPage /></PageLayout></AuthGate>} />
        <Route path="/retry" element={<AuthGate><PageLayout><RetryProblemsPage /></PageLayout></AuthGate>} />
        <Route path="/recent" element={<AuthGate><PageLayout><RecentProblemsPage /></PageLayout></AuthGate>} />
        <Route path="/stats" element={<AuthGate><PageLayout><StatsPage /></PageLayout></AuthGate>} />
        <Route path="/problems" element={<AuthGate><PageLayout><AllProblemsPage /></PageLayout></AuthGate>} />
        <Route path="/profile" element={<AuthGate><PageLayout><ProfilePage /></PageLayout></AuthGate>} />

        {/* 학생 - 과제 */}
        <Route path="/assignments" element={<AuthGate><PageLayout><RoleGate allowedRoles={['student']}><AssignmentsPage /></RoleGate></PageLayout></AuthGate>} />
        <Route path="/assignments/:assignmentId" element={<AuthGate><PageLayout><RoleGate allowedRoles={['student']}><AssignmentSolvePage /></RoleGate></PageLayout></AuthGate>} />

        {/* 선생님 */}
        <Route path="/teacher/dashboard" element={<AuthGate><PageLayout><RoleGate allowedRoles={['teacher']}><TeacherDashboardPage /></RoleGate></PageLayout></AuthGate>} />
        <Route path="/teacher/classes/:classId" element={<AuthGate><PageLayout><RoleGate allowedRoles={['teacher', 'director']}><ClassDetailPage /></RoleGate></PageLayout></AuthGate>} />
        <Route path="/teacher/assignments/create" element={<AuthGate><PageLayout><RoleGate allowedRoles={['teacher', 'director']}><AssignmentCreatePage /></RoleGate></PageLayout></AuthGate>} />
        <Route path="/teacher/assignments/:assignmentId" element={<AuthGate><PageLayout><RoleGate allowedRoles={['teacher', 'director']}><AssignmentDetailPage /></RoleGate></PageLayout></AuthGate>} />

        {/* 학부모 */}
        <Route path="/parent/dashboard" element={<AuthGate><PageLayout><RoleGate allowedRoles={['parent']}><ParentDashboardPage /></RoleGate></PageLayout></AuthGate>} />

        {/* 학원장 */}
        <Route path="/director/dashboard" element={<AuthGate><PageLayout><RoleGate allowedRoles={['director']}><DirectorDashboardPage /></RoleGate></PageLayout></AuthGate>} />

        {/* 학원 관리 */}
        <Route path="/academies" element={<AuthGate><PageLayout><AcademyListPage /></PageLayout></AuthGate>} />
        <Route path="/academies/new" element={<AuthGate><PageLayout><AcademyCreatePage /></PageLayout></AuthGate>} />
        <Route path="/academies/:id/members" element={<AuthGate><PageLayout><RoleGate allowedRoles={['director']}><AcademyMembersPage /></RoleGate></PageLayout></AuthGate>} />

        <Route path="*" element={
          <AuthGate>
            <PageLayout>
              <div className="text-center py-10">
                <a href="/upload" className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 dark:hover:text-indigo-300">
                  {language === 'ko' ? '문제 업로드하러 가기' : 'Go to Upload'}
                </a>
              </div>
            </PageLayout>
          </AuthGate>
        } />
      </Routes>
      <InstallBanner />
    </UserRoleProvider>
  );
};

export default App;
