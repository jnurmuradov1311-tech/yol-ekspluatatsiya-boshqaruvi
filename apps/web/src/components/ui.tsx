"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api/client";

export function Button({
  children,
  variant = "primary",
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
}) {
  return (
    <button className={`button button--${variant}`} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {busy ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function TextInput({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const fieldId = props.id ?? props.name;
  const helpId = fieldId ? `${fieldId}-help` : undefined;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <input className="input" id={fieldId} aria-describedby={hint || error ? helpId : undefined} aria-invalid={Boolean(error)} {...props} />
      {hint || error ? <span className={error ? "field__error" : "field__hint"} id={helpId}>{error ?? hint}</span> : null}
    </label>
  );
}

export function SelectInput({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const fieldId = props.id ?? props.name;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <select className="input" id={fieldId} {...props}>{children}</select>
    </label>
  );
}

export function TextArea({ label, hint, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const fieldId = props.id ?? props.name;
  const helpId = fieldId ? `${fieldId}-help` : undefined;
  return (
    <label className="field" htmlFor={fieldId}>
      <span className="field__label">{label}</span>
      <textarea className="input textarea" id={fieldId} aria-describedby={hint ? helpId : undefined} {...props} />
      {hint ? <span className="field__hint" id={helpId}>{hint}</span> : null}
    </label>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "Ma’lumot yuklanmoqda" }: { label?: string }) {
  return (
    <div className="state-panel" aria-live="polite" aria-busy="true">
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertCircle aria-hidden="true" />
      <div>
        <strong>Ma’lumotni olib bo‘lmadi</strong>
        <p>{error.message}</p>
        {requestId ? <small>So‘rov raqami: {requestId}</small> : null}
      </div>
      {retry ? <Button variant="secondary" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> Qayta urinish</Button> : null}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-panel">
      <Inbox aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-frame" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}
