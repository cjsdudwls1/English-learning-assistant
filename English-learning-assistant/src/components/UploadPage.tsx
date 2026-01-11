import React from 'react';
import { ImageUploader } from './ImageUploader';
import { Loader } from './Loader';
import { getTranslation } from '../utils/translations';

interface UploadPageProps {
  language: 'ko' | 'en';
  imageFiles: File[];
  isLoading: boolean;
  error: string | null;
  onImagesSelect: (files: File[]) => void;
  onAnalyzeClick: () => void;
}

export const UploadPage: React.FC<UploadPageProps> = ({
  language,
  imageFiles,
  isLoading,
  error,
  onImagesSelect,
  onAnalyzeClick,
}) => {
  const t = getTranslation(language);

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-800 rounded-2xl shadow-lg p-6 md:p-8 border border-slate-200 dark:border-slate-700">
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          {language === 'ko' 
            ? '📸 문제 이미지를 업로드하면 즉시 "업로드되었습니다!" 메시지가 표시됩니다. AI 분석은 백그라운드에서 진행되며, 통계 페이지에서 결과를 확인할 수 있습니다.'
            : '📸 When you upload a problem image, you will immediately see an "Uploaded!" message. AI analysis runs in the background, and you can check the results on the statistics page.'}
        </p>
      </div>
      <ImageUploader onImagesSelect={onImagesSelect} />
      <div className="mt-6 text-center">
        <button
          onClick={onAnalyzeClick}
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
  );
};

