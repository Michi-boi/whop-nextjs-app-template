import { waitUntil } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { whopsdk } from "@/lib/whop-sdk";
import { tvNameKey, notifyTvName } from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";

const redis = Redis.fromEnv();

const ALLOWED_PRODUCT_ID = "prod_vPTqfmAJBrWMa";
const TV_QUESTION_TEXT = "Wie lautet dein TradingView-Benutzername?";

export async function POST(request: NextRequest): Promise<Response> {
  const requestBodyText = await request.text();
  const headers = Object.fromEntries(request.headers);
  const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

  // NEU: feuert sofort beim Start einer Mitgliedschaft (auch im Trial, ohne Zahlung)
  if (webhookData.type === "membership.activated") {
    waitUntil(handleMembershipActivated(webhookData.data));
  }

  if (webhookData.type === "payment.succeeded") {
    waitUntil(handlePaymentSucceeded(webhookData.data));
  }

  if (webhookData.type === "membership.deactivated") {
    waitUntil(handleMembershipDeactivated(webhookData.data));
  }

  return new Response("OK", { status: 200 });
}

// Sofort bei Mitgliedschaftsstart: liest den Checkout-Namen aus dem Formular
// und schreibt ihn direkt ins Redis - ganz ohne auf die erste Zahlung zu warten.
async function handleMembershipActivated(membership: any) {
  if (membership.product?.id !== ALLOWED_PRODUCT_ID) return;

  const userId = membership.user?.id;
  const username = membership.user?.username ?? membership.user?.name ?? "unbekannt";
  if (!userId) return;

  const question = membership.custom_field_responses?.find(
    (q: any) => q.question === TV_QUESTION_TEXT
  );
  const checkoutName = question?.answer;
  if (!checkoutName) return;

  await redis.set(tvNameKey(userId), checkoutName);

  await notifyTvName({
    userId,
    username,
    tvName: checkoutName,
    membershipId: membership.id,
    billingReason: "trial_started",
  });
}

// Bei jeder Zahlung: Checkout-Name wird NUR bei einem echten Neukauf
// (subscription_create) übernommen - nicht bei normalen Verlängerungen
// (subscription_cycle), damit ein später in der App geänderter Name nicht
// wieder überschrieben wird.
async function handlePaymentSucceeded(payment: any) {
  if (payment.product?.id !== ALLOWED_PRODUCT_ID) return;

  const userId = payment.member?.user?.id ?? payment.user?.id;
  const username = payment.member?.user?.username ?? "unbekannt";
  if (!userId) return;

  const billingReason = payment.billing_reason;

  if (billingReason === "subscription_create") {
    const question = payment.custom_field_responses?.find(
      (q: any) => q.question === TV_QUESTION_TEXT
    );
    const checkoutName = question?.answer;
    if (checkoutName) {
      await redis.set(tvNameKey(userId), checkoutName);
    }
  }

  const tvName = (await redis.get<string>(tvNameKey(userId))) ?? "-";

  await notifyTvName({
    userId,
    username,
    tvName,
    membershipId: payment.membership?.id,
    billingReason:
      billingReason === "subscription_create"
        ? "subscription_create"
        : "subscription_cycle",
  });
}

// Kündigung (Churn) - unverändert
async function handleMembershipDeactivated(membership: any) {
  if (membership.product?.id !== ALLOWED_PRODUCT_ID) return;
  await notifyChurn(membership);
}
