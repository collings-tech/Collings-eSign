import { useEffect, useRef } from 'react';
import AirDatepicker from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';

export default function DatePicker({ value, onChange, onClose, autoFocus = false, fontSize = '0.875rem' }) {
  const inputRef = useRef(null);
  const datepickerRef = useRef(null);

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

    const initialDate = parseAustralianDate(value) || new Date();

    datepickerRef.current = new AirDatepicker(inputRef.current, {
      locale: localeEn,
      dateFormat: 'dd/MM/yyyy',
      selectedDates: [initialDate],
      autoClose: false,  // Disable autoClose, we'll handle it manually
      position: 'bottom left',
      onSelect: ({ date, formattedDate }) => {
        if (date && formattedDate) {
          onChange(formattedDate);
          // Close the picker after state update
          setTimeout(() => {
            if (datepickerRef.current) {
              datepickerRef.current.hide();
            }
          }, 50);
        }
      },
      onHide: (isFinished) => {
        // Only trigger onClose when animation is fully finished
        if (isFinished && onClose) {
          onClose();
        }
      }
    });

    // Show the datepicker immediately
    if (autoFocus) {
      setTimeout(() => {
        datepickerRef.current.show();
      }, 0);
    }

    return () => {
      if (datepickerRef.current) {
        datepickerRef.current.destroy();
      }
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="prepare-placed-field-inline-input"
      style={{ fontSize }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (onClose) {
            onClose();
          }
        }
        e.stopPropagation();
      }}
      placeholder="DD/MM/YYYY"
      autoFocus={autoFocus}
    />
  );
}
