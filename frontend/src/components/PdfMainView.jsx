import { useState, useEffect, useRef } from "react";
import { pdfjs, Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MAIN_PAGE_WIDTH = 800;

export default function PdfMainView({
  fileUrl,
  pageRotations = {},
  currentPage,
  onPageCount,
}) {
  const [numPages, setNumPages] = useState(null);
  const pageRefs = useRef({});

  useEffect(() => {
    setNumPages(null);
  }, [fileUrl]);

  useEffect(() => {
    if (currentPage == null || currentPage < 1) return;
    const el = pageRefs.current[currentPage];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentPage]);

  if (!fileUrl) return null;

  const onLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    onPageCount?.(n);
  };

  return (
    <div className="pdf-viewer pdf-main-view">
      <Document
        file={fileUrl}
        onLoadSuccess={onLoadSuccess}
        loading={<span className="prepare-thumb-loading">Loading…</span>}
        error={<span className="prepare-thumb-error">Failed to load PDF</span>}
      >
        {numPages != null &&
          Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const rotation = pageRotations[pageNum] || 0;
            return (
              <div
                key={pageNum}
                ref={(el) => { pageRefs.current[pageNum] = el; }}
                data-rp={`page-${pageNum}`}
                className="pdf-main-view-page"
              >
                <Page
                  pageNumber={pageNum}
                  width={MAIN_PAGE_WIDTH}
                  rotate={rotation}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                />
              </div>
            );
          })}
      </Document>
    </div>
  );
}
