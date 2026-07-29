import { NextRequest, NextResponse } from "next/server";
import { whopsdk } from "@/lib/whop-sdk";
import { notifyTvName, extractTvNameFromMembership } from "@/lib/tv-notify";
import { notifyChurn } from "@/lib/churn-notify";
import { redis, tvNameKey } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const event = JSON.parse(body);

  // NEU: Feuert SOFORT bei Mitgliedschaftsstart (auch im Trial, ohne Zahlung)
  if (event.type === "membership.activated") {
    try {
      const membershipData = event.data;
      const membershipId = membershipData?.id;
      const userId = membershipData?.user?.id;
      const companyId = membershipData?.company?.id;

      if (userId && companyId) {
        let membership = membershipData;
        if (!membership?.custom_field_responses && membershipId) {
          membership = await whopsdk.memberships.retrieve(membershipId);
        }
        const tvNameFromCheckout = extractTvNameFromMembership(membership);
        if (tvNameFromCheckout) {
          await notifyTvName({ userId, companyId, newName: tvNameFromCheckout, billingReason: "trial_started" });
        }
      }
    } catch (e) {
      console.error("Fehler bei membership.activated Verarbeitung:", e);
    }
  }

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

      const billingReason = payment.billing_reason ?? null;
      const isNewMembership = billingReason === "subscription_create";

      let tvNameFromCheckout: string | null = null;

      if (isNewMembership && membershipId) {
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
