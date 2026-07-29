import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { whopsdk } from "@/lib/whop-sdk";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { userId } = await whopsdk.verifyUserToken(await headers());
    return NextResponse.json(
      { userId },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    console.error("Fehler beim Verifizieren des Nutzers:", e);
    return NextResponse.json(
      { userId: null },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
