import { useState, useEffect, useRef } from "react";
import { pdfjs, Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Renders a single thumbnail only when it scrolls near the viewport,
// preventing out-of-memory crashes on large PDFs on mobile.
function LazyThumbnailPage({
  pageNumber,
  rotation,
  isCurrent,
  onPageSelect,
  onRotate,
  onDelete,
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 300px top/bottom margin so pages preload just before they scroll in
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`prepare-thumbnail-item${isCurrent ? " prepare-thumbnail-item-current" : ""}`}
    >
      <div
        className="prepare-thumbnail-canvas"
        role="button"
        tabIndex={0}
        onClick={() => onPageSelect?.(pageNumber)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPageSelect?.(pageNumber);
          }
        }}
        aria-label={`Go to page ${pageNumber}`}
        style={!loaded ? { minHeight: 170, background: "var(--color-bg-nav, #f0f0f0)", borderRadius: 4 } : undefined}
      >
        {loaded && (
          <Page
            pageNumber={pageNumber}
            width={120}
            rotate={rotation}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        )}
      </div>
      <div className="prepare-thumbnail-actions">
        <span className="prepare-thumb-page-num">Page&nbsp;{pageNumber}</span>
        <button
          type="button"
          className="prepare-thumb-icon"
          aria-label="Rotate page"
          onClick={(e) => {
            e.stopPropagation();
            onRotate?.(pageNumber);
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
            onDelete?.(pageNumber);
          }}
        >
          <i className="lni lni-trash-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}

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
              <LazyThumbnailPage
                key={pageNum}
                pageNumber={pageNum}
                rotation={rotation}
                isCurrent={isCurrent}
                onPageSelect={onPageSelect}
                onRotate={onRotate}
                onDelete={onDelete}
              />
            );
          })}
      </Document>
    </div>
  );
}
