export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8" role="status" aria-label="正在加载搜索">
      <div className="h-11 w-48 animate-pulse rounded-lg bg-black/[.06] dark:bg-white/[.08]" />
      <div className="mt-3 h-5 w-full max-w-md animate-pulse rounded-lg bg-black/[.04] dark:bg-white/[.06]" />
      <div className="glass mt-7 h-16 animate-pulse rounded-lg" />
      <div className="mt-5 flex gap-2">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-10 w-20 animate-pulse rounded-lg bg-black/[.05] dark:bg-white/[.07]" />
        ))}
      </div>
      <div className="mt-5 space-y-3">
        {[0, 1, 2].map((item) => <div key={item} className="glass h-28 animate-pulse rounded-lg" />)}
      </div>
      <span className="sr-only">正在加载搜索</span>
    </div>
  );
}
