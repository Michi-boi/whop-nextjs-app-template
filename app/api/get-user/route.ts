import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";

export async function GET(req: NextRequest) {
  try {
    const user = await whopsdk.users.retrieveCurrentUser();
    return NextResponse.json({ userId: user.id });
  } catch (e) {
    console.error("Fehler beim Abrufen des aktuellen Users:", e);
    return NextResponse.json({ error: "Fehler beim Abrufen der User-ID" }, { status: 500 });
  }
}
