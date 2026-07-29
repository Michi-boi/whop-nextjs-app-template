import { whopsdk } from "@/lib/whop-sdk";

// Die Frage aus dem Checkout-Formular
export const TV_QUESTION_TEXT = "Wie lautet dein TradingView-Benutzername?";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;

const COLORS = {
  neu: 0x22c55e,      // grün – neuer Kauf / neuer Trial
  update: 0x3b82f6,   // blau – Name in der App geändert
  standard: 0x9ca3af, // grau – normale Verlängerung
};

// Rechnet aus, wie viele Tage bis zu einem Datum noch übrig sind
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diffMs = new Date(dateStr).getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

// Holt Status + Trial-Ende direkt von Whop
export async function getMembershipDetails(membershipId: string) {
  const membership = await whopsdk.memberships.retrieve(membershipId);
  return {
    status: membership.status,
    trialEndsAt: membership.renewal_period_end,
  };
}

// Liest den TradingView-Namen aus den Checkout-Antworten heraus.
// Funktioniert sowohl für ein Membership-Objekt als auch für ein Payment-Objekt,
// da beide ein "custom_field_responses"-Feld im gleichen Format haben.
export function extractTvNameFromMembership(record: any): string | null {
  const question = record?.custom_field_responses?.find(
    (q: any) => q.question === TV_QUESTION_TEXT
  );
  return question?.answer ?? null;
}

type NotifyParams = {
  userId: string;
  username: string;
  tvName: string;
  membershipId: string;
  billingReason:
    | "trial_started"
    | "subscription_create"
    | "subscription_cycle"
    | "manual_update";
};

export async function notifyTvName({
  userId,
  username,
  tvName,
  membershipId,
  billingReason,
}: NotifyParams) {
  const { status, trialEndsAt } = await getMembershipDetails(membershipId);

  let icon = "🔄";
  let title = "TradingView-Name aktualisiert";
  let color = COLORS.standard;

  // WICHTIG: dieser Zweig muss VOR "subscription_create" stehen
  if (billingReason === "trial_started") {
    icon = "🆕";
    title = "Trial gestartet";
    color = COLORS.neu;
  } else if (billingReason === "subscription_create") {
    icon = "🆕";
    title = "Neue Zahlung eingegangen";
    color = COLORS.neu;
  } else if (billingReason === "subscription_cycle") {
    icon = "💳";
    title = "Verlängerung eingegangen";
    color = COLORS.standard;
  } else if (billingReason === "manual_update") {
    icon = "✏️";
    title = "Name in der App geändert";
    color = COLORS.update;
  }

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "👤 Nutzer", value: username, inline: true },
    { name: "📈 TradingView-Name", value: tvName || "-", inline: true },
  ];

  if (status === "trialing") {
    const days = daysUntil(trialEndsAt);
    fields.push({
      name: "🧪 Test-Phase endet in",
      value: days !== null ? `${days} Tag(e)` : "unbekannt",
      inline: true,
    });
  }

  await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: `${icon} ${title}`,
          color,
          fields,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}
