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
  const adminPendingSales = notificationType === "admin_pending_sales";
  const adminDsrReady = notificationType === "admin_dsr_ready";
  const adminDsrConfirmedStock = notificationType === "admin_dsr_confirmed_stock";
  const adminNotification = adminPendingSales || adminDsrReady || adminDsrConfirmedStock;

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
  let stockLines: string[] = [];
  if (adminDsrConfirmedStock) {
    // Read active tank inventory and product colour metadata so each line in
    // the single phone notification is easy to scan by product.
    const tanksUrl = new URL("/rest/v1/tanks", supabaseUrl);
    tanksUrl.searchParams.set("active", "eq.true");
    tanksUrl.searchParams.set("select", "tank_code,product,current_liters,active");
    tanksUrl.searchParams.set("order", "tank_code.asc");
    const [tanksResponse, productsResponse] = await Promise.all([
      fetch(tanksUrl, { headers: restHeaders }),
      fetch(new URL("/rest/v1/products?select=*", supabaseUrl), { headers: restHeaders }),
    ]);
    const products: Array<Record<string, unknown>> = productsResponse.ok
      ? await productsResponse.json() as Array<Record<string, unknown>>
      : [];
    const normalize = (value: unknown) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const productColor = (productName: string) => {
      const match = products.find((item) =>
        [item.name, item.product, item.product_name, item.code, item.product_code, item.product_type]
          .some((value) => normalize(value) === normalize(productName))
      );
      if (!match) return "";
      const raw = Object.entries(match).find(([key, value]) =>
        /color|colour|hex/i.test(key) && typeof value === "string" && /^#?[0-9a-f]{3,8}$/i.test(value.trim())
      )?.[1];
      return typeof raw === "string" ? raw.trim().replace(/^#/, "") : "";
    };
    const colorDot = (hex: string) => {
      if (!hex) return "🔹";
      let value = hex;
      if (value.length === 3) value = value.split("").map((part) => part + part).join("");
      if (value.length !== 6) return "🔹";
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      const palette = [
        { emoji: "🔴", rgb: [235, 55, 55] },
        { emoji: "🟠", rgb: [245, 145, 35] },
        { emoji: "🟡", rgb: [245, 205, 45] },
        { emoji: "🟢", rgb: [45, 175, 95] },
        { emoji: "🔵", rgb: [50, 125, 235] },
        { emoji: "🟣", rgb: [150, 80, 205] },
        { emoji: "⚫", rgb: [45, 45, 45] },
        { emoji: "⚪", rgb: [220, 220, 220] },
      ];
      return palette.sort((a, b) =>
        (a.rgb[0] - r) ** 2 + (a.rgb[1] - g) ** 2 + (a.rgb[2] - b) ** 2 -
        ((b.rgb[0] - r) ** 2 + (b.rgb[1] - g) ** 2 + (b.rgb[2] - b) ** 2)
      )[0].emoji;
    };
    if (tanksResponse.ok) {
      const tanks = await tanksResponse.json() as Array<{tank_code?: string; product?: string; current_liters?: number | string; active?: boolean}>;
      stockLines = tanks.map((tank) => {
        const code = String(tank.tank_code || "Tank");
        const product = String(tank.product || "Unknown product");
        const amount = Number(tank.current_liters);
        const liters = Number.isFinite(amount) ? amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "—";
        const dot = colorDot(productColor(product));
        return `${dot} ${product}  ·  ${code}  —  ${liters} L`;
      });
    }
  }
  const title = adminDsrConfirmedStock ? `DSR confirmed · Tank stock summary (${stockLines.length})`
    : adminPendingSales ? "Sales pending confirmation"
    : adminDsrReady ? "DSR ready for confirmation"
    : recordSaleReady ? "Record sale ready" : "Incoming shift handover";
  const message = adminDsrConfirmedStock
    ? (stockLines.length ? `Report date: ${handoverId}\n\n${stockLines.join("\n")}` : `Report date: ${handoverId}\nTank stock details are unavailable. Open Tanks to refresh.`)
    : adminPendingSales
      ? "A shift sale has been submitted and is waiting for administrator confirmation."
      : adminDsrReady
        ? `The daily sales report for ${handoverId} is ready for review and confirmation.`
        : recordSaleReady
          ? `${senderName} confirmed the shift handover. Record the shift sales now.`
          : `${senderName} sent you a handover that needs your confirmation.`;
  const payload = JSON.stringify({
    title,
    body: message,
    tag: adminDsrConfirmedStock ? `admin-dsr-stock-${handoverId}`
      : adminDsrReady ? `admin-dsr-${handoverId}`
      : adminPendingSales ? `admin-sales-${handoverId}`
      : recordSaleReady ? `record-sale-${handoverId}` : `handover-${handoverId}`,
    url: adminDsrConfirmedStock ? "/admin-inventory.html"
      : adminDsrReady ? `/admin-daily-report.html#dsr-${encodeURIComponent(handoverId)}`
      : adminPendingSales ? "/admin-sales.html"
      : recordSaleReady ? "/attendant-dashboard.html"
      : `/attendant-dashboard.html?handover=${encodeURIComponent(handoverId)}`,
    icon: adminNotification ? "/icons/admin-icon.svg" : "/icons/attendant-icon.svg",
    handover_id: handoverId,
    notification_type: notificationType,
    stock_lines: stockLines,
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
