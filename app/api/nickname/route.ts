import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName } from "@/lib/tv-notify";
import { redis, tvNameKey } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const { userId, companyId, nickname } = await req.json();
    if (!userId || !companyId || !nickname) {
      return NextResponse.json({ error: "Fehlende Daten" }, { status: 400 });
    }

    // Neuen Namen speichern - "wer zuletzt schreibt, gewinnt"
    await redis.set(tvNameKey(userId), nickname);

    // Nutzername für die Discord-Nachricht holen
    const user = await whopsdk.users.retrieve(userId);
    const username = user?.username ?? user?.name ?? userId;

    await notifyTvName({
      userId,
      username,
      tvName: nickname,
      billingReason: "manual_update",
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Fehler in /api/nickname:", e);
    return NextResponse.json({ error: "Serverfehler" }, { status: 500 });
  }
}
