import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = Deno.env.get("PUSH_DELIVERY_TOKEN") || "";
  const authorization = req.headers.get("authorization") || "";
  if (!token || authorization !== `Bearer ${token}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!publicKey || !privateKey || !supabaseUrl || !serviceKey) {
    return json({ error: "Push delivery is not configured" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const employeeId = String(body.to_employee_id || "");
  const handoverId = String(body.handover_id || "");
  const senderName = String(body.sender_name || "Another attendant").slice(0, 100);
  const notificationType = String(body.notification_type || "incoming");
  if (!employeeId || !handoverId) {
    return json({ error: "to_employee_id and handover_id are required" }, 400);
  }
  const recordSaleReady = notificationType === "record_sale_ready";

  const restHeaders = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };
  const query = new URL("/rest/v1/push_subscriptions", supabaseUrl);
  query.searchParams.set("employee_id", `eq.${employeeId}`);
  query.searchParams.set("select", "id,endpoint,p256dh,auth");
  const subsResponse = await fetch(query, { headers: restHeaders });
  if (!subsResponse.ok) return json({ error: "Could not load push subscriptions" }, 502);
  const subscriptions = await subsResponse.json() as Array<{
    id: string; endpoint: string; p256dh: string; auth: string;
  }>;

  if (!subscriptions.length) return json({ sent: 0, expired: 0, reason: "No subscribed devices" });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({
    title: recordSaleReady ? "Record sale ready" : "Incoming shift handover",
    body: recordSaleReady
      ? `${senderName} confirmed the shift handover. Record the shift sales now.`
      : `${senderName} sent you a handover that needs your confirmation.`,
    tag: recordSaleReady ? `record-sale-${handoverId}` : `handover-${handoverId}`,
    url: recordSaleReady
      ? "/attendant-dashboard.html"
      : `/attendant-dashboard.html?handover=${encodeURIComponent(handoverId)}`,
    handover_id: handoverId,
    notification_type: recordSaleReady ? "record_sale_ready" : "incoming",
  });

  let sent = 0;
  let expired = 0;
  const results = await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, payload, { TTL: 60 * 60 });
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        expired++;
        const del = new URL("/rest/v1/push_subscriptions", supabaseUrl);
        del.searchParams.set("id", `eq.${sub.id}`);
        await fetch(del, { method: "DELETE", headers: restHeaders });
      }
    }
  }));
  return json({ sent, expired });
});
