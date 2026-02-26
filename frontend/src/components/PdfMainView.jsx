import { useState, useEffect, useRef } from "react";
import { pdfjs, Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MAIN_PAGE_WIDTH = 800;

/**
 * PdfMainView renders PDF pages. Each page is wrapped in a PageWrapper (position: relative)
 * with an optional OverlayLayer (position: absolute; inset: 0) so fields can be positioned
 * with percentages relative to that page. This survives zoom, mobile, and resizing.
 */
export default function PdfMainView({
  fileUrl,
  pageRotations = {},
  currentPage,
  onPageCount,
  fixedPageWidth,
  /** Render overlay content for each page. Receives pageNum. Overlay is position: absolute; inset: 0. */
  renderPageOverlay,
}) {
  const [numPages, setNumPages] = useState(null);
  const [containerWidth, setContainerWidth] = useState(fixedPageWidth ?? MAIN_PAGE_WIDTH);
  const pageRefs = useRef({});
  const containerRef = useRef(null);

  useEffect(() => {
    setNumPages(null);
  }, [fileUrl]);

  useEffect(() => {
    if (fixedPageWidth != null && fixedPageWidth > 0) {
      setContainerWidth(fixedPageWidth);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0]?.contentRect ?? {};
      if (width > 0) setContainerWidth(Math.round(width));
    });
    ro.observe(el);
    setContainerWidth(el.offsetWidth || MAIN_PAGE_WIDTH);
    return () => ro.disconnect();
  }, [fixedPageWidth]);

  useEffect(() => {
    if (currentPage == null || currentPage < 1) return;
    const el = pageRefs.current[currentPage];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [currentPage]);

  if (!fileUrl) return null;

  const pageWidth = fixedPageWidth != null && fixedPageWidth > 0
    ? fixedPageWidth
    : Math.max(280, Math.min(containerWidth, MAIN_PAGE_WIDTH));

  const onLoadSuccess = ({ numPages: n }) => {
    setNumPages(n);
    onPageCount?.(n);
  };

  return (
    <div
      ref={containerRef}
      className="pdf-viewer pdf-main-view"
      style={fixedPageWidth != null && fixedPageWidth > 0 ? { width: fixedPageWidth, minWidth: fixedPageWidth, maxWidth: fixedPageWidth } : undefined}
    >
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
                className="pdf-main-view-page pdf-page-wrapper"
              >
                <Page
                  pageNumber={pageNum}
                  width={pageWidth}
                  rotate={rotation}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                />
                {renderPageOverlay && (
                  <div className="pdf-page-overlay" style={{ position: "absolute", inset: 0, zIndex: 10 }}>
                    {renderPageOverlay(pageNum)}
                  </div>
                )}
              </div>
            );
          })}
      </Document>
    </div>
  );
}
