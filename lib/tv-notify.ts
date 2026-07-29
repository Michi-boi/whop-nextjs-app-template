import { whopsdk } from "@/lib/whop-sdk";

const ALLOWED_PRODUCT_ID = "prod_vPTqfmAJBrWMa";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;

const TV_QUESTION_TEXT = "Wie lautet dein TradingView-Benutzername?";

export type BillingReason =
  | "trial_started"
  | "subscription_create"
  | "subscription_cycle"
  | "manual_update";

interface NotifyTvNameParams {
  userId: string;
  companyId: string;
  tvName: string;
  billingReason: BillingReason;
  paymentAmount?: number; // nur bei echten Zahlungen mitgeben
  paymentCurrency?: string; // z.B. "eur"
}

interface MembershipContext {
  username: string;
  displayName: string | null;
  email: string | null;
  productTitle: string | null;
  formattedRenewalPrice: string | null;
  status: string | null;
  renewalPeriodEnd: string | null;
}

/** Liest den TradingView-Namen aus der Checkout-Frage einer Mitgliedschaft aus. */
export function extractTvNameFromMembership(membership: {
  custom_field_responses?: { question: string; answer: string }[];
}): string | null {
  const match = membership.custom_field_responses?.find(
    (r) => r.question === TV_QUESTION_TEXT
  );
  return match?.answer ?? null;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Findet automatisch die passende Mitgliedschaft für einen Nutzer
 * (in dieser Firma, für dieses Produkt) und liefert alle Infos,
 * die für die Discord-Nachricht gebraucht werden.
 */
async function getMembershipContext(
  userId: string,
  companyId: string
): Promise<MembershipContext> {
  const page = await whopsdk.memberships.list({
    company_id: companyId,
    user_ids: [userId],
    product_ids: [ALLOWED_PRODUCT_ID],
    first: 1,
    order: "created_at",
    direction: "desc",
  });

  const membership = page.data[0];

  if (!membership) {
    return {
      username: userId,
      displayName: null,
      email: null,
      productTitle: null,
      formattedRenewalPrice: null,
      status: null,
      renewalPeriodEnd: null,
    };
  }

  return {
    username: membership.user?.username ?? userId,
    displayName: membership.user?.name ?? null,
    email: membership.user?.email ?? null,
    productTitle: membership.product?.title ?? null,
    formattedRenewalPrice: membership.formatted_renewal_price ?? null,
    status: membership.status ?? null,
    renewalPeriodEnd: membership.renewal_period_end ?? null,
  };
}

function statusLabel(
  status: string | null,
  billingReason: BillingReason
): string {
  if (billingReason === "trial_started") return "🆕 Erstkunde (im Trial)";
  if (billingReason === "subscription_create") return "🆕 Erstkunde";
  if (billingReason === "subscription_cycle") return "💳 Bestandskunde";

  // manual_update -> Status direkt von der Mitgliedschaft ableiten
  switch (status) {
    case "trialing":
      return "🆕 Erstkunde (im Trial)";
    case "active":
      return "💳 Bestandskunde";
    case "past_due":
      return "⚠️ Zahlung überfällig";
    case "canceling":
      return "🚪 Kündigung angekündigt";
    case "canceled":
      return "❌ Gekündigt";
    case "expired":
      return "⏰ Abgelaufen";
    default:
      return status ? `ℹ️ ${status}` : "ℹ️ Unbekannt";
  }
}

export async function notifyTvName(params: NotifyTvNameParams): Promise<void> {
  const { userId, companyId, tvName, billingReason, paymentAmount, paymentCurrency } =
    params;

  if (!DISCORD_WEBHOOK_URL) return;

  const ctx = await getMembershipContext(userId, companyId);

  const lines: string[] = [];

  lines.push(
    `👤 Whop-Nutzer: ${ctx.username}${ctx.displayName ? ` (${ctx.displayName})` : ""}`
  );
  if (ctx.email) lines.push(`📧 E-Mail: ${ctx.email}`);
  if (ctx.productTitle) lines.push(`📦 Produkt: ${ctx.productTitle}`);
  if (ctx.formattedRenewalPrice)
    lines.push(`🔁 Abo-Zyklus: ${ctx.formattedRenewalPrice}`);

  // Nur anzeigen, wenn wirklich ein Betrag vorliegt (behebt den "undefined"-Bug)
  if (paymentAmount !== undefined && paymentAmount !== null && paymentCurrency) {
    lines.push(
      `💵 Zahlung: ${paymentAmount.toFixed(2)} ${paymentCurrency.toUpperCase()}`
    );
  }

  lines.push(`📈 TradingView-Name: ${tvName}`);
  lines.push(`📌 Status: ${statusLabel(ctx.status, billingReason)}`);

  const trialDays = daysUntil(ctx.renewalPeriodEnd);
  if (ctx.status === "trialing" && trialDays !== null) {
    lines.push(`🧪 Test-Phase endet in: ${trialDays} Tagen`);
  }

  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: lines.join("\n") }),
  });
}
