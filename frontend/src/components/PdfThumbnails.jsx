import { useState, useEffect } from "react";
import { pdfjs, Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function PdfThumbnails({
  fileUrl,
  onPageCount,
  onPageSelect,
  onRotate,
  onDelete,
  pageRotations = {},
  currentPage,
  firstPageOnly = false,
}) {
  const [numPages, setNumPages] = useState(null);

  useEffect(() => {
    setNumPages(null);
  }, [fileUrl]);

  if (!fileUrl) return null;

  const onLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    onPageCount?.(n);
  };

  return (
    <div className="prepare-pdf-thumbnails">
      <Document
        file={fileUrl}
        onLoadSuccess={onLoadSuccess}
        loading={<span className="prepare-thumb-loading">Loading…</span>}
        error={<span className="prepare-thumb-error">Failed to load PDF</span>}
      >
        {numPages != null &&
          Array.from({ length: firstPageOnly ? 1 : numPages }, (_, i) => {
            const pageNum = i + 1;
            const rotation = pageRotations[pageNum] || 0;
            const isCurrent = currentPage === pageNum;
            return (
              <div
                key={i}
                className={`prepare-thumbnail-item${isCurrent ? " prepare-thumbnail-item-current" : ""}`}
              >
                <div
                  className="prepare-thumbnail-canvas"
                  role="button"
                  tabIndex={0}
                  onClick={() => onPageSelect?.(pageNum)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPageSelect?.(pageNum);
                    }
                  }}
                  aria-label={`Go to page ${pageNum}`}
                >
                  <Page
                    pageNumber={pageNum}
                    width={120}
                    rotate={rotation}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </div>
                <div className="prepare-thumbnail-actions">
                  <span className="prepare-thumb-page-num">Page {pageNum}</span>
                  <button
                    type="button"
                    className="prepare-thumb-icon"
                    aria-label="Rotate page"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRotate?.(pageNum);
                    }}
                  >
                    <i className="lni lni-refresh-circle-1-clockwise" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="prepare-thumb-icon"
                    aria-label="Delete page"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(pageNum);
                    }}
                  >
                    <i className="lni lni-trash-3" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
      </Document>
    </div>
  );
}
