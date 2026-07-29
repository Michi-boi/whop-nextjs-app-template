import { Redis } from "@upstash/redis";
import { sendDiscordEmbedTo } from "@/lib/discord";

const redis = Redis.fromEnv();

const ALLOWED_PRODUCT_ID = "prod_vPTqfmAJBrWMa"; // Seasonality Scanner Indikator
const CHURN_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL_CHURN!;

function tvNameKey(userId: string) {
  return `tvname:${userId}`;
}

const CANCEL_OPTION_LABELS: Record<string, string> = {
  too_expensive: "Zu teuer",
  switching: "Wechselt zu anderem Anbieter",
  missing_features: "Fehlende Funktionen",
  technical_issues: "Technische Probleme",
  bad_experience: "Schlechte Erfahrung",
  other: "Sonstiges",
  testing: "Nur zum Testen",
};

export async function notifyChurn(membership: any) {
  // Nur melden, wenn es wirklich um den Indikator geht (nicht Gratis-Kurs)
  if (membership?.product?.id !== ALLOWED_PRODUCT_ID) {
    return;
  }

  const user = membership?.user;
  const userId = user?.id;

  // TradingView-Namen aus Redis holen (falls hinterlegt)
  const tvName = userId ? await redis.get<string>(tvNameKey(userId)) : null;

  const fields: { name: string; value: string; inline?: boolean }[] = [
    {
      name: "👤 Whop-Nutzer",
      value: user?.name || user?.username || user?.id || "Unbekannt",
      inline: true,
    },
    {
      name: "📧 E-Mail",
      value: user?.email || "Unbekannt",
      inline: true,
    },
    {
      name: "📈 TradingView-Name",
      value: tvName || "Nicht hinterlegt",
      inline: true,
    },
    {
      name: "📦 Produkt",
      value: membership?.product?.title || "Seasonality Scanner Indikator",
      inline: false,
    },
  ];

  if (membership?.cancel_option) {
    fields.push({
      name: "❌ Grund",
      value: CANCEL_OPTION_LABELS[membership.cancel_option] ?? membership.cancel_option,
      inline: true,
    });
  }

  if (membership?.cancellation_reason) {
    fields.push({
      name: "📝 Kommentar des Kunden",
      value: membership.cancellation_reason,
      inline: false,
    });
  }

  if (membership?.canceled_at) {
    const date = new Date(membership.canceled_at);
    fields.push({
      name: "🗓️ Gekündigt am",
      value: date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }),
      inline: true,
    });
  }

  fields.push({
    name: "📌 Status",
    value: membership?.status || "Unbekannt",
    inline: true,
  });

  await sendDiscordEmbedTo(CHURN_WEBHOOK_URL, {
    title: "⚠️ Kunde verloren – Abo beendet",
    color: 0xe74c3c, // Rot
    fields,
  });
}
