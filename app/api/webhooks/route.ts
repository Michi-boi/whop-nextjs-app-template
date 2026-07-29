import { waitUntil } from "@vercel/functions";
import type { NextRequest } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import {
  notifyTvName,
  extractTvNameFromMembership,
} from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";
import { redis, tvNameKey } from "@/lib/redis";

const ALLOWED_PRODUCT_ID = "prod_vPTqfmAJBrWMa";

export async function POST(request: NextRequest): Promise<Response> {
  const requestBodyText = await request.text();
  const headers = Object.fromEntries(request.headers);
  const webhookData = whopsdk.webhooks.unwrap(requestBodyText, { headers });

  // Feuert sofort beim Start einer Mitgliedschaft (auch im Trial, ohne Zahlung)
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
  const companyId = membership.company?.id;
  if (!userId || !companyId) return;

  // Nur beim Trial-Start feuern - vermeidet doppelte Nachrichten bei
  // normalen Aktivierungen ohne Trial (die laufen über payment.succeeded).
  if (membership.status !== "trialing") return;

  const checkoutName = extractTvNameFromMembership(membership);
  if (!checkoutName) return;

  await redis.set(tvNameKey(userId), checkoutName);

  await notifyTvName({
    userId,
    companyId,
    tvName: checkoutName,
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
  const companyId = payment.company?.id;
  if (!userId || !companyId) return;

  const billingReason = payment.billing_reason;

  if (billingReason === "subscription_create") {
    const checkoutName = extractTvNameFromMembership(payment);
    if (checkoutName) {
      await redis.set(tvNameKey(userId), checkoutName);
    }
  }

  const tvName = (await redis.get<string>(tvNameKey(userId))) ?? "-";

  await notifyTvName({
    userId,
    companyId,
    tvName,
    billingReason:
      billingReason === "subscription_create"
        ? "subscription_create"
        : "subscription_cycle",
    paymentAmount: payment.amount_after_fees,
    paymentCurrency: payment.currency,
  });
}

// Kündigung (Churn) - unverändert
async function handleMembershipDeactivated(membership: any) {
  if (membership.product?.id !== ALLOWED_PRODUCT_ID) return;
  await notifyChurn(membership);
}
