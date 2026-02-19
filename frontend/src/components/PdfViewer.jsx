import { Worker, Viewer } from '@react-pdf-viewer/core';
import '@react-pdf-viewer/core/lib/styles/index.css';

const PDF_WORKER_URL =
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export default function PdfViewer({ fileUrl, currentPage, initialPage = 0 }) {
  const pageIndex = currentPage != null && currentPage >= 1 ? currentPage - 1 : initialPage;
  // Key by fileUrl + page so when user clicks a thumbnail we remount with the right initialPage
  // (avoids page-navigation plugin which was causing destroy/lifecycle errors)
  const viewerKey = fileUrl ? `${fileUrl}-${pageIndex}` : 'no-file';

  if (!fileUrl) return null;

  return (
    <div className="pdf-viewer">
      <Worker workerUrl={PDF_WORKER_URL}>
        <Viewer
          key={viewerKey}
          fileUrl={fileUrl}
          initialPage={pageIndex}
        />
      </Worker>
    </div>
  );
}

