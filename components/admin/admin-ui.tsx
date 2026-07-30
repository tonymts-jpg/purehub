import type { ReactNode } from "react";

export function AdminPageState({
  title,
  message,
  onRetry
}: {
  title: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <section role="status" className="rounded-2xl border border-[var(--line)] p-6 text-center">
      <h2 className="text-lg font-black">{title}</h2>
      {message ? <p className="mt-2 text-sm muted">{message}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-4 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold">
          重试
        </button>
      ) : null}
    </section>
  );
}

export function AdminTable({ headers, children }: { headers: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-black/5 dark:bg-white/5">
          <tr>{headers.map((header) => <th key={header} className="px-4 py-3 font-black">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">{children}</tbody>
      </table>
    </div>
  );
}

export function AdminStatus({ children, tone = "neutral" }: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-black/5 text-[var(--text)] dark:bg-white/10",
    success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    danger: "bg-rose-500/15 text-rose-700 dark:text-rose-300"
  };

  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}
