import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "default" | "accent" | "quiet" | "danger" | "danger-solid";

const toneClass: Record<Tone, string> = {
  default: "bg-surface border border-line hover:bg-sunken text-text",
  accent: "bg-accent text-on-accent hover:opacity-90 border border-transparent",
  quiet: "hover:bg-sunken text-muted hover:text-text border border-transparent",
  danger: "bg-surface border border-line text-danger hover:bg-sunken",
  "danger-solid": "bg-danger text-white hover:opacity-90 border border-transparent",
};

export function Button({
  tone = "default",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-1.5 text-sm";
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${sizing} ${toneClass[tone]} ${className}`}
    />
  );
}

export function IconButton({ label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-sunken hover:text-text transition-colors disabled:opacity-40 ${className}`}
    />
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between first:mt-0">
      <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="text-[15px] font-medium text-text">{title}</div>
      {children && <div className="max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface ${className}`}>{children}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}
