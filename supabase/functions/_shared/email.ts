// The only place that knows about the email provider (Brevo). To switch
// providers, rewrite this one function and keep the { ok, error } contract.
export async function sendEmail(to: { name: string; email: string }, subject: string, html: string) {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": Deno.env.get("BREVO_API_KEY") ?? "",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: Deno.env.get("EMAIL_FROM_NAME"), email: Deno.env.get("EMAIL_FROM") },
        to: [to],
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) return { ok: false, error: `Brevo ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function badgeEmail(name: string, badge: string, link: string) {
  return {
    subject: `Your badge: ${badge}`,
    html: `<p>Hi ${esc(name)},</p>
<p>SAC Team IEEE Colombia has awarded you the badge <strong>${esc(badge)}</strong>.</p>
<p><a href="${esc(link)}">View and verify your badge</a></p>
<p>On that page you can download the signed credential and add it to your LinkedIn profile.</p>`,
  };
}
