import { NextRequest, NextResponse } from "next/server";
import { redis, tvNameKey } from "@/lib/redis";
import { notifyTvName } from "@/lib/tv-notify";

export async function POST(req: NextRequest) {
  try {
    const { userId, companyId, nickname } = await req.json();

    if (!userId || !companyId || !nickname) {
      return NextResponse.json(
        { error: "userId, companyId und nickname sind erforderlich" },
        { status: 400 }
      );
    }

    await redis.set(tvNameKey(userId), nickname);

    await notifyTvName({
      userId,
      companyId,
      tvName: nickname,
      billingReason: "manual_update",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Fehler beim Speichern des TradingView-Namens:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
