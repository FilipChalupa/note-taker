"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

function Box() {
  const { m } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form
      role="search"
      className="ml-auto min-w-0 flex-1 sm:w-64 sm:flex-none"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
      }}
    >
      <input
        type="search"
        className="input py-1 text-sm"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={m.nav.search}
        aria-label={m.nav.search}
      />
    </form>
  );
}

export function SearchBox() {
  return (
    <Suspense fallback={null}>
      <Box />
    </Suspense>
  );
}
