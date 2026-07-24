export default function ChannelsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8" role="status" aria-label="正在加载频道目录">
      <div className="h-11 w-48 animate-pulse rounded-lg bg-black/[.06] dark:bg-white/[.08]" />
      <div className="mt-3 h-5 w-full max-w-lg animate-pulse rounded-lg bg-black/[.04] dark:bg-white/[.06]" />
      <div className="glass mt-7 h-28 animate-pulse rounded-lg" />
      <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="glass aspect-[4/3] animate-pulse rounded-lg" />
        ))}
      </div>
      <span className="sr-only">正在加载频道目录</span>
    </div>
  );
}
