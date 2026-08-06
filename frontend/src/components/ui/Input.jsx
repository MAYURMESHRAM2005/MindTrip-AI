import React, { forwardRef } from 'react';
import { cn } from '../../utils/format';

const baseField = ({ error, className }) =>
  cn('input', error && 'border-rose-400 focus:ring-rose-400/50 focus:border-rose-400', className);

export const Field = ({ label, hint, error, children }) => (
  <div>
    {label && <label className="label">{label}</label>}
    {children}
    {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    {error && <p className="mt-1 text-xs font-medium text-rose-500">{error}</p>}
  </div>
);

export const Input = forwardRef(function Input({ label, hint, error, className, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      <input ref={ref} className={baseField({ error, className })} {...props} />
    </Field>
  );
});

export const Textarea = forwardRef(function Textarea({ label, hint, error, className, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea ref={ref} className={cn(baseField({ error, className }), 'min-h-[90px]')} {...props} />
    </Field>
  );
});

export const Select = forwardRef(function Select({ label, hint, error, options, className, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      <select ref={ref} className={baseField({ error, className })} {...props}>
        {options.map((opt) =>
          typeof opt === 'string' ? (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ) : (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          )
        )}
      </select>
    </Field>
  );
});

export default Input;
