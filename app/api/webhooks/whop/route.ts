import { kv } from "@vercel/kv";
import { whopsdk } from "@/lib/whop-sdk";
import { NextResponse } from "next/server";

async function sendToDiscord(message: string) {
  await fetch(process.env.DISCORD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  const event = whopsdk.webhooks.unwrap(body, { headers: req.headers });

  if (event.type === "payment.succeeded") {
    const payment = event.data;
    const userId = payment.user?.id;
    const amount = payment.total;

    if (!userId) return NextResponse.json({ ok: true });

    const nickname = await kv.get<string>(`nickname:${userId}`);

    if (nickname) {
      await sendToDiscord(`💰 **Neue Zahlung:** $${amount} von **${nickname}**`);
    } else {
      // Nickname noch nicht bekannt -> zur späteren Zustellung merken
      const pending = (await kv.get<number[]>(`pending:${userId}`)) ?? [];
      pending.push(amount);
      await kv.set(`pending:${userId}`, pending);
    }
  }

  return NextResponse.json({ ok: true });
}
