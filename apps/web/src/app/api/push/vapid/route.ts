import { NextResponse } from "next/server";
import { getVapidPublicKey, subscriptionCount } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey(), subscribers: subscriptionCount() });
}
