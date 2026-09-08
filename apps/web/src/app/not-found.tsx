import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-semibold">Nenalezeno</h1>
      <p className="mt-2 text-zinc-500">Tato nahrávka neexistuje nebo byla smazána.</p>
      <Link href="/" className="btn mt-6">Zpět na přehled</Link>
    </div>
  );
}
