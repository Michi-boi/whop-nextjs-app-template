import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName, extractTvNameFromMembership } from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";
import { redis, tvNameKey } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const event = JSON.parse(body);

  if (event.type === "payment.succeeded") {
    try {
      const payment = event.data;
      const membershipId = payment.membership?.id;
      const userId = payment.user?.id ?? payment.user_id;
      const companyId = payment.company?.id ?? payment.company_id;

      if (!userId || !companyId) {
        console.error("payment.succeeded: userId oder companyId fehlt", payment.id);
        return NextResponse.json({ received: true });
      }

      let tvNameFromCheckout: string | null = null;

      if (membershipId) {
        try {
          const membership = await whopsdk.memberships.retrieve(membershipId);
          tvNameFromCheckout = extractTvNameFromMembership(membership);
        } catch (e) {
          console.error("Fehler beim Laden der Mitgliedschaft:", e);
        }
      }

      const paymentInfo = {
        amount: payment.final_amount ?? payment.amount,
        currency: payment.currency,
      };

      const billingReason = payment.billing_reason ?? null;

      if (tvNameFromCheckout) {
        await notifyTvName({ userId, companyId, newName: tvNameFromCheckout, payment: paymentInfo, billingReason });
      } else {
        const existing = await redis.get<string>(tvNameKey(userId));
        if (existing) {
          await notifyTvName({ userId, companyId, newName: null, payment: paymentInfo, billingReason });
        }
      }
    } catch (e) {
      console.error("Fehler bei payment.succeeded Verarbeitung:", e);
    }
  }

  if (event.type === "membership.deactivated") {
    try {
      await notifyChurn(event.data);
    } catch (e) {
      console.error("Fehler bei membership.deactivated Verarbeitung:", e);
    }
  }

  return NextResponse.json({ received: true });
}
