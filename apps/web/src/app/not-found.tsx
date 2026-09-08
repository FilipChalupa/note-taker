import Link from "next/link";
import { getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const { m } = await getMessages();
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-semibold">{m.notFound.title}</h1>
      <p className="mt-2 text-zinc-500">{m.notFound.text}</p>
      <Link href="/" className="btn mt-6">
        {m.notFound.back}
      </Link>
    </div>
  );
}
