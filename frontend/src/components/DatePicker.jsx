import { useEffect, useRef } from 'react';
import AirDatepicker from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';

export default function DatePicker({ value, onChange, onClose, autoFocus = false, fontSize = '0.875rem', className = 'prepare-placed-field-inline-input' }) {
  const inputRef = useRef(null);
  const datepickerRef = useRef(null);

  // Always-current refs so AirDatepicker callbacks (created once) never use stale closures
  const onChangeRef = useRef(onChange);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Parse Australian date format (DD/MM/YYYY) to Date object
  const parseAustralianDate = (dateStr) => {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return new Date(year, month - 1, day);
    }
    return null;
  };

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

    // Pre-select the existing value silently (no onSelect event)
    const initialDate = parseAustralianDate(value);
    if (initialDate) {
      datepickerRef.current.selectDate(initialDate, { silent: true });
    }

    // Show the datepicker immediately
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
