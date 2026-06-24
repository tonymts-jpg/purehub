"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { trendData } from "@/lib/data";

export default function IncomeChart(){
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={trendData}>
      <defs><linearGradient id="income" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7957e8" stopOpacity={.45}/><stop offset="95%" stopColor="#7957e8" stopOpacity={0}/></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={.12}/>
      <XAxis dataKey="name" axisLine={false} tickLine={false}/>
      <Tooltip/>
      <Area type="monotone" dataKey="income" stroke="#7957e8" strokeWidth={3} fill="url(#income)"/>
    </AreaChart>
  </ResponsiveContainer>;
}
