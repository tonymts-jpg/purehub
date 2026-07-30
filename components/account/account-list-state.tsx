import type { ReactNode } from "react";

type AccountListStateProps = {
  loading: boolean;
  error: string | null;
  empty: boolean;
  onRetry: () => void;
  children: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function AccountListState({
  loading,
  error,
  empty,
  onRetry,
  children,
  emptyTitle = "还没有内容",
  emptyDescription = "去发现更多感兴趣的内容吧。"
}: AccountListStateProps) {
  if (loading && empty) {
    return <p role="status" className="glass rounded-lg px-5 py-12 text-center font-semibold muted">正在加载…</p>;
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-300">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="rounded-lg border border-current px-3 py-1.5 text-sm font-bold">重试</button>
        </div>
      )}
      {empty && !error ? (
        <section className="glass rounded-lg px-5 py-14 text-center">
          <h2 className="text-lg font-black">{emptyTitle}</h2>
          <p className="mt-2 text-sm muted">{emptyDescription}</p>
        </section>
      ) : children}
    </>
  );
}
