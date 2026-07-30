import type { BuyerOrderListItem } from "@/lib/account/types";

const statusLabels: Record<string, string> = {
  pending: "待支付",
  pending_payment: "待支付",
  paid: "已支付",
  fulfilled: "已支付",
  succeeded: "已支付",
  failed: "支付失败",
  payment_failed: "支付失败",
  refunded: "已退款",
  charged_back: "已退款"
};

function statusLabel(status: string) {
  return statusLabels[status] ?? "支付失败";
}

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount / 100);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function OrderHistory({ orders }: { orders: BuyerOrderListItem[] }) {
  return (
    <>
      <div data-testid="order-history-table" className="hidden overflow-x-auto rounded-[28px] border border-[var(--line)] md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-black/[.03] text-xs font-black uppercase tracking-wide muted dark:bg-white/[.04]">
            <tr>
              <th scope="col" className="px-5 py-4">订单编号</th>
              <th scope="col" className="px-5 py-4">内容</th>
              <th scope="col" className="px-5 py-4">创作者</th>
              <th scope="col" className="px-5 py-4">金额</th>
              <th scope="col" className="px-5 py-4">支付方式</th>
              <th scope="col" className="px-5 py-4">状态</th>
              <th scope="col" className="px-5 py-4">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => <tr key={order.id} className="border-t border-[var(--line)]">
              <td className="px-5 py-4 font-mono text-xs">{order.id}</td>
              <td className="px-5 py-4 font-bold">{order.itemLabel ?? order.itemId}</td>
              <td className="px-5 py-4">{order.creator.name}</td>
              <td className="px-5 py-4 font-bold">{formatAmount(order.amount, order.currency)}</td>
              <td className="px-5 py-4">{order.provider ?? "—"}</td>
              <td className="px-5 py-4"><span className="rounded-full bg-violet/10 px-3 py-1 text-xs font-black text-violet">{statusLabel(order.status)}</span></td>
              <td className="px-5 py-4 whitespace-nowrap muted">{formatTime(order.createdAt)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div data-testid="order-history-cards" className="grid gap-4 md:hidden">
        {orders.map((order) => <article key={order.id} className="glass rounded-2xl p-5 shadow-soft">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs muted">订单编号</p><p className="mt-1 break-all font-mono text-xs">{order.id}</p></div><span className="rounded-full bg-violet/10 px-3 py-1 text-xs font-black text-violet">{statusLabel(order.status)}</span></div>
          <h2 className="mt-4 text-lg font-black">{order.itemLabel ?? order.itemId}</h2>
          <p className="mt-1 text-sm muted">{order.creator.name}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 text-sm"><div><dt className="muted">金额</dt><dd className="mt-1 font-black">{formatAmount(order.amount, order.currency)}</dd></div><div><dt className="muted">支付方式</dt><dd className="mt-1 font-bold">{order.provider ?? "—"}</dd></div></dl>
          <p className="mt-4 text-xs muted">创建于 {formatTime(order.createdAt)}</p>
        </article>)}
      </div>
    </>
  );
}
