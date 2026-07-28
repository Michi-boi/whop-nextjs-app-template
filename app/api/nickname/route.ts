import { NextRequest, NextResponse } from "next/server";
import { notifyTvName } from "@/lib/tv-notify";

export async function POST(req: NextRequest) {
  try {
    const { userId, companyId, nickname } = await req.json();
    if (!userId || !companyId || !nickname) {
      return NextResponse.json({ error: "Fehlende Daten" }, { status: 400 });
    }
    await notifyTvName({ userId, companyId, newName: nickname });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fehler in /api/nickname:", e);
    return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
  }
}
