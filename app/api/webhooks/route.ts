import { waitUntil } from "@vercel/functions";
import type { Payment } from "@whop/sdk/resources.js";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";

const kv = Redis.fromEnv();

async function sendToDiscord(message: string) {
	await fetch(process.env.DISCORD_WEBHOOK_URL!, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content: message }),
	});
}

export async function POST(request: NextRequest): Promise<Response> {
	// Validate the webhook to ensure it's from Whop
	const requestBodyText = await request.text();
	const headers = Object.fromEntries(request.headers);
	const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

	// Handle the webhook event
	if (webhookData.type === "payment.succeeded") {
		waitUntil(handlePaymentSucceeded(webhookData.data));
	}

	// Make sure to return a 2xx status code quickly. Otherwise the webhook will be retried.
	return new Response("OK", { status: 200 });
}

async function handlePaymentSucceeded(payment: Payment) {
	const userId = payment.user?.id;
	const amount = payment.total ?? 0;

	if (!userId) return;

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
