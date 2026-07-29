export async function sendDiscordMessage(content: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL fehlt");
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    console.error("Discord-Nachricht fehlgeschlagen:", e);
  }
}

type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

type DiscordEmbed = {
  title: string;
  color: number;
  fields: DiscordEmbedField[];
};

export async function sendDiscordEmbed(embed: DiscordEmbed) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL fehlt");
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) {
    console.error("Discord-Embed fehlgeschlagen:", e);
  }
}


export async function sendDiscordEmbedTo(
  webhookUrl: string,
  embed: { title: string; color: number; fields: { name: string; value: string; inline?: boolean }[] }
) {
  if (!webhookUrl) {
    console.error("Discord Webhook URL fehlt (Ziel-Webhook nicht konfiguriert)");
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: embed.title,
          color: embed.color,
          fields: embed.fields,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Discord Webhook Fehler:", res.status, text);
  }
}

