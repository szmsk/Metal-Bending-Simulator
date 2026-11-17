import React, { useEffect, useRef, useState } from 'react';

interface NumericFieldProps {
  value: number;
  min: number;
  max: number;
  decimals?: number;
  allowZero?: boolean;
  zeroFallback?: number;
  allowNegative?: boolean;
  ariaLabel?: string;
  className?: string;
  onChange: (nextValue: number) => void;
}

export const NumericField: React.FC<NumericFieldProps> = ({
  value,
  min,
  max,
  decimals,
  allowZero = true,
  zeroFallback = 15,
  allowNegative = false,
  ariaLabel,
  className = '',
  onChange,
}) => {
  const formatVal = (v: number) =>
    decimals !== undefined ? v.toFixed(decimals) : String(v);

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatVal(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isFocused) {
      setDraft(formatVal(value));
    }
  }, [value, isFocused, decimals]);

  const parseDraft = (raw: string): number | null => {
    const normalized = raw.trim().replace(',', '.');
    if (
      normalized === '' ||
      normalized === '-' ||
      normalized === '.' ||
      normalized === '-.'
    ) {
      return null;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  const clampAndNormalize = (num: number): number => {
    let clamped = Math.max(min, Math.min(max, num));
    if (!allowZero && clamped === 0) {
      clamped = zeroFallback;
    }
    return decimals !== undefined ? Number(clamped.toFixed(decimals)) : clamped;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // Allow free keyboard typing of digits, decimal point/comma, and optional leading minus
    const pattern = allowNegative ? /^-?\d*([.,]\d*)?$/ : /^\d*([.,]\d*)?$/;
    if (!pattern.test(raw)) return;

    setDraft(raw);

    // Don't interrupt user if they are mid-decimal (e.g. "2." or "2,")
    if (raw.endsWith('.') || raw.endsWith(',')) return;

    const parsed = parseDraft(raw);
    if (parsed !== null && parsed >= min && parsed <= max) {
      if (!allowZero && parsed === 0) return;
      const next = decimals !== undefined ? Number(parsed.toFixed(decimals)) : parsed;
      onChange(next);
    }
  };

  const commitDraft = () => {
    const parsed = parseDraft(draft);
    if (parsed === null) {
      setDraft(formatVal(value));
      return;
    }
    const finalVal = clampAndNormalize(parsed);
    onChange(finalVal);
    setDraft(formatVal(finalVal));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitDraft();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setDraft(formatVal(value));
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      onFocus={(e) => {
        setIsFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setIsFocused(false);
        commitDraft();
      }}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className={className}
    />
  );
};
