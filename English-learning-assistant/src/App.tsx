import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from './services/supabaseClient';
import { AuthGate } from './components/AuthGate';
import { PageLayout } from './components/PageLayout';
// 라우트 페이지는 지연 로딩한다. 정적 import이던 시절 전체가 단일 청크(1.22MB)로 묶여
// Vite의 500kB 경고가 상시로 떴고, 학생 하나가 원장·교사 화면까지 전부 내려받았다.
// MainPage만 예외로 정적 유지 — '/'와 '/upload'의 첫 화면이라 지연시키면 초기 표시가 되레 늦다.
// lazy()는 default export를 기대하는데 이 프로젝트는 named export라 매핑해준다.
const EditPage = lazy(() => import('./pages/EditPage').then(m => ({ default: m.EditPage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then(m => ({ default: m.StatsPage })));
const RecentProblemsPage = lazy(() => import('./pages/RecentProblemsPage').then(m => ({ default: m.RecentProblemsPage })));
const AnalyzingPage = lazy(() => import('./pages/AnalyzingPage').then(m => ({ default: m.AnalyzingPage })));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage').then(m => ({ default: m.SessionDetailPage })));
const RetryProblemsPage = lazy(() => import('./pages/RetryProblemsPage').then(m => ({ default: m.RetryProblemsPage })));
const AllProblemsPage = lazy(() => import('./pages/AllProblemsPage').then(m => ({ default: m.AllProblemsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const TeacherDashboardPage = lazy(() => import('./pages/TeacherDashboardPage').then(m => ({ default: m.TeacherDashboardPage })));
const AssignmentsPage = lazy(() => import('./pages/AssignmentsPage').then(m => ({ default: m.AssignmentsPage })));
const AssignmentSolvePage = lazy(() => import('./pages/AssignmentSolvePage').then(m => ({ default: m.AssignmentSolvePage })));
const ParentDashboardPage = lazy(() => import('./pages/ParentDashboardPage').then(m => ({ default: m.ParentDashboardPage })));
const DirectorDashboardPage = lazy(() => import('./pages/DirectorDashboardPage').then(m => ({ default: m.DirectorDashboardPage })));
const AcademyListPage = lazy(() => import('./pages/AcademyListPage').then(m => ({ default: m.AcademyListPage })));
const AcademyCreatePage = lazy(() => import('./pages/AcademyCreatePage').then(m => ({ default: m.AcademyCreatePage })));
const AcademyMembersPage = lazy(() => import('./pages/AcademyMembersPage').then(m => ({ default: m.AcademyMembersPage })));
const ClassDetailPage = lazy(() => import('./components/teacher/ClassDetailPage').then(m => ({ default: m.ClassDetailPage })));
const AssignmentCreatePage = lazy(() => import('./components/teacher/AssignmentCreatePage').then(m => ({ default: m.AssignmentCreatePage })));
const AssignmentDetailPage = lazy(() => import('./components/teacher/AssignmentDetailPage').then(m => ({ default: m.AssignmentDetailPage })));
import { RoleGate } from './components/RoleGate';
import { UserRoleProvider } from './contexts/UserRoleContext';
import { useLanguage } from './contexts/LanguageContext';
import { getTranslation } from './utils/translations';
import { InstallBanner } from './components/InstallBanner';
import { MainPage, type ImageFile } from './pages/MainPage';
import './styles/app.css';

const MAX_IMAGES = 10;
const ANALYSIS_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Canvas API로 이미지를 리사이즈·JPEG 압축한다.
 * 긴 변 maxDimension 이하로 축소, quality 기본 0.92.
 *
 * 2026-08-16: 1200px·0.8 → 2048px·0.92. 시험지 사진에서 판독 대상은 연필로 흐리게 친
 * 동그라미와 작은 체크 표시인데, 스마트폰 원본(3000px+)을 1200px로 줄이고 JPEG 0.8을
 * 먹이면 그 획이 배경과 뭉개져 사라진다. 모델이 못 읽는 게 아니라 볼 것이 안 간 것이다.
 * Gemini는 이미지를 768px 타일로 쪼개 처리하므로 1200px는 장당 4타일에 그친다.
 * 2048px면 타일이 늘어 획당 픽셀이 확보된다(입력 토큰은 그만큼 증가).
 */
function compressImage(
  file: File,
  maxDimension = 2048,
  quality = 0.92,
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
  const t = getTranslation(language);
  const navigate = useNavigate();

  // 언어에 따라 브라우저 탭 제목(document.title)을 갱신한다. (정적 index.html title의 런타임 보정)
  useEffect(() => {
    document.title = t.app.title;
  }, [t.app.title]);
  const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const handleAnalyzeClick = useCallback(async () => {
    if (imageFiles.length === 0) {
      setError(t.upload.uploadFirst);
      return;
    }

    setIsLoading(true);
    setStatus('loading');
    setError(null);

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setError(t.errors.loginRequired);
        setIsLoading(false);
        setStatus('error');
        return;
      }

      if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
        setError(t.errors.envNotSet);
        setIsLoading(false);
        setStatus('error');
        return;
      }

      const gcfUrl = import.meta.env.VITE_ANALYZE_GCF_URL;
      if (!userData.user?.id) {
        setError(t.errors.cannotGetUserId);
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
        throw new Error(t.errors.sessionExpired);
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
              throw new Error(t.errors.serviceComingSoon);
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
        throw new Error(t.errors.sessionCreateFailed);
      }

      setIsLoading(false);
      setStatus('done');
      setImageFiles([]);
      navigate('/stats');
    } catch (err) {
      const fallback = t.errors.uploadFailed;
      setError(err instanceof Error ? err.message : fallback);
      setIsLoading(false);
      setStatus('error');
    }
  }, [imageFiles, language, t, navigate]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const imageFilesArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFilesArray.length === 0) {
      setError(t.errors.imageOnly);
      return;
    }

    setImageFiles((prev) => {
      const remainingSlots = MAX_IMAGES - prev.length;
      if (remainingSlots <= 0) {
        setError(t.errors.maxImages.replace('{max}', String(MAX_IMAGES)));
        return prev;
      }

      const filesToAdd = imageFilesArray.slice(0, remainingSlots);
      if (filesToAdd.length < imageFilesArray.length) {
        setError(
          t.errors.maxImagesPartial
            .replace('{max}', String(MAX_IMAGES))
            .replace('{count}', String(filesToAdd.length)),
        );
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
  }, [t]);

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
      {/* 지연 로딩 청크를 받는 동안의 대기 화면.
          문구는 t.common.loading('불러오는 중...'/'Loading...')을 그대로 쓴다 —
          e2e의 waitForRenderSettled가 이 문자열을 로딩 신호로 보고 대기하므로,
          다른 문구를 쓰면 청크 수신 중을 '렌더 완료'로 오독한다. */}
      <Suspense fallback={<div className="py-6 sm:py-16 text-center text-slate-500 dark:text-slate-400">{t.common.loading}</div>}>
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
        <Route path="/academies/new" element={<AuthGate><PageLayout><RoleGate allowedRoles={['director']}><AcademyCreatePage /></RoleGate></PageLayout></AuthGate>} />
        <Route path="/academies/:id/members" element={<AuthGate><PageLayout><RoleGate allowedRoles={['director']}><AcademyMembersPage /></RoleGate></PageLayout></AuthGate>} />

        <Route path="*" element={
          <AuthGate>
            <PageLayout>
              <div className="text-center py-6 sm:py-10">
                <a href="/upload" className="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-800 dark:hover:text-indigo-300">
                  {t.errors.goToUpload}
                </a>
              </div>
            </PageLayout>
          </AuthGate>
        } />
      </Routes>
      </Suspense>
      <InstallBanner />
    </UserRoleProvider>
  );
};

export default App;
