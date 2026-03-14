import { useState, useEffect, useRef } from "react";
import { pdfjs, Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MAIN_PAGE_WIDTH = 800;

/**
 * Renders a single PDF page only when it is near the viewport.
 * The outer wrapper div is always in the DOM so pageRefs / scrollIntoView
 * keep working even before the page has loaded.
 */
function LazyPage({
  pageNum,
  pageWidth,
  rotation,
  renderPageOverlay,
  wrapperRef,
}) {
  const [loaded, setLoaded] = useState(false);
  const innerRef = useRef(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    // 400px margin: start loading before the page is fully on screen
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Estimate A4 portrait height as placeholder to keep scroll positions stable.
  // Once the real page loads this collapses to the true height.
  const placeholderHeight = Math.round(pageWidth * 1.414);

  return (
    <div
      ref={(el) => {
        // Expose both the outer ref (for scroll-to-page) and inner ref (for observer)
        if (wrapperRef) wrapperRef(el);
        innerRef.current = el;
      }}
    >
      {loaded ? (
        <>
          <Page
            pageNumber={pageNum}
            width={pageWidth}
            rotate={rotation}
            renderTextLayer={true}
            renderAnnotationLayer={false}
          />
          {renderPageOverlay && (
            <div
              className="pdf-page-overlay"
              style={{ position: "absolute", inset: 0, zIndex: 10 }}
            >
              {renderPageOverlay(pageNum)}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            width: pageWidth,
            height: placeholderHeight,
            background: "var(--color-bg-nav, #f5f5f5)",
            borderRadius: 4,
          }}
        />
      )}
    </div>
  );
}

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
        loading={
          <div className="pdf-main-loading">
            <div className="pdf-main-spinner" />
          </div>
        }
        error={<span className="prepare-thumb-error">Failed to load PDF</span>}
      >
        {numPages != null &&
          Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const rotation = pageRotations[pageNum] || 0;
            return (
              <div
                key={pageNum}
                data-rp={`page-${pageNum}`}
                className="pdf-main-view-page pdf-page-wrapper"
              >
                <LazyPage
                  pageNum={pageNum}
                  pageWidth={pageWidth}
                  rotation={rotation}
                  renderPageOverlay={renderPageOverlay}
                  wrapperRef={(el) => { pageRefs.current[pageNum] = el; }}
                />
              </div>
            );
          })}
      </Document>
    </div>
  );
}
