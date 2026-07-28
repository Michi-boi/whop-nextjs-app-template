import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { whopsdk } from "@/lib/whop-sdk";

export async function GET() {
  try {
    const { userId } = await whopsdk.verifyUserToken(await headers());
    return NextResponse.json({ userId });
  } catch (e) {
    console.error("Fehler beim Verifizieren des Nutzers:", e);
    return NextResponse.json({ userId: null }, { status: 401 });
  }
}
