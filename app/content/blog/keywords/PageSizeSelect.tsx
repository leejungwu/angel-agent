"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function PageSizeSelect({ pageSize }: { pageSize: number }) {
  const router = useRouter(), pathname = usePathname(), searchParams = useSearchParams();
  return <select aria-label="페이지당 개수" name="pageSize" defaultValue={pageSize} className="rounded border p-2" onChange={event => {
    const value = event.currentTarget.value;
    const query = new URLSearchParams(searchParams.toString());
    query.set("pageSize", ["15", "30", "50"].includes(value) ? value : "30");
    query.set("page", "1");
    router.push(`${pathname}?${query}`);
  }}>
    {[15, 30, 50].map(size => <option key={size} value={size}>{size}개씩</option>)}
  </select>;
}
