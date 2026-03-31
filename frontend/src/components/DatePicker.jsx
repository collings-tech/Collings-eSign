import { useEffect, useRef } from 'react';
import AirDatepicker from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';

// Detect touch/mobile device — use native date picker for better UX
const isMobile = () =>
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

// DD/MM/YYYY  →  YYYY-MM-DD  (for native <input type="date">)
const toISODate = (ddmmyyyy) => {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return '';
};

// YYYY-MM-DD  →  DD/MM/YYYY
const fromISODate = (isoDate) => {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }
  return '';
};

// Parse DD/MM/YYYY to Date object
const parseAustralianDate = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return new Date(year, month - 1, day);
  }
  return null;
};

export default function DatePicker({ value, onChange, onClose, autoFocus = false, fontSize = '0.875rem', className = 'prepare-placed-field-inline-input' }) {
  const inputRef = useRef(null);
  const datepickerRef = useRef(null);

  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // ── Native mobile date picker ─────────────────────────────────────────────
  if (isMobile()) {
    return (
      <input
        ref={inputRef}
        type="date"
        className={className}
        style={{ fontSize, minHeight: '2rem', touchAction: 'manipulation' }}
        value={toISODate(value)}
        onChange={(e) => {
          const formatted = fromISODate(e.target.value);
          if (formatted) {
            onChangeRef.current(formatted);
            // slight delay so the value commits before we close
            setTimeout(() => onCloseRef.current?.(), 150);
          }
        }}
        onBlur={() => onCloseRef.current?.()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        autoFocus={autoFocus}
        aria-label="Select date"
      />
    );
  }

  // ── Desktop: AirDatepicker ────────────────────────────────────────────────
  return (
    <DesktopDatePicker
      value={value}
      onChangeRef={onChangeRef}
      onCloseRef={onCloseRef}
      autoFocus={autoFocus}
      fontSize={fontSize}
      className={className}
    />
  );
}

function DesktopDatePicker({ value, onChangeRef, onCloseRef, autoFocus, fontSize, className }) {
  const inputRef = useRef(null);
  const datepickerRef = useRef(null);

  useEffect(() => {
    if (!inputRef.current) return;

    datepickerRef.current = new AirDatepicker(inputRef.current, {
      locale: localeEn,
      dateFormat: 'dd/MM/yyyy',
      autoClose: true,
      position: 'bottom left',
      onSelect: ({ date, formattedDate }) => {
        if (date && formattedDate) {
          onChangeRef.current(Array.isArray(formattedDate) ? formattedDate[0] : formattedDate);
        }
      },
      onHide: (isFinished) => {
        if (isFinished) {
          onCloseRef.current?.();
        }
      }
    });

    const initialDate = parseAustralianDate(value);
    if (initialDate) {
      datepickerRef.current.selectDate(initialDate, { silent: true });
    }

    if (autoFocus) {
      setTimeout(() => {
        datepickerRef.current?.show();
      }, 0);
    }

    return () => {
      datepickerRef.current?.destroy();
      datepickerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      style={{ fontSize }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          onCloseRef.current?.();
        }
        e.stopPropagation();
      }}
      placeholder="DD/MM/YYYY"
      autoFocus={autoFocus}
    />
  );
}
