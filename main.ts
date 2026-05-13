const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
};

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function extraParams(params: URLSearchParams): string {
  let extra = "";
  for (const key of ["ua", "referer", "cookie", "auth"]) {
    const val = params.get(key);
    if (val) extra += `&${key}=${encodeURIComponent(val)}`;
  }
  return extra;
}

function rewriteDASH(text: string, baseUrl: string, proxyBase: string, extra: string): string {
  let rewritten = text;
  rewritten = rewritten.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_m, innerUrl) => {
    const full = innerUrl.startsWith("http") ? innerUrl : baseUrl + innerUrl;
    return `<BaseURL>${proxyBase}${encodeURIComponent(full)}${extra}</BaseURL>`;
  });
  rewritten = rewritten.replace(/(media|initialization)="([^"]+)"/g, (match, attr, val) => {
    if (val.includes("$")) return match;
    const full = val.startsWith("http") ? val : baseUrl + val;
    return `${attr}="${proxyBase}${encodeURIComponent(full)}${extra}"`;
  });
  return rewritten;
}

function rewriteHLS(text: string, baseUrl: string, proxyBase: string, extra: string): string {
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.includes('URI="')) {
      return trimmed.replace(/URI="([^"]+)"/g, (_m, uri) => {
        const full = uri.startsWith("http") ? uri : baseUrl + uri;
        return `URI="${proxyBase}${encodeURIComponent(full)}${extra}"`;
      });
    }
    if (trimmed && !trimmed.startsWith("#")) {
      const full = trimmed.startsWith("http") ? trimmed : baseUrl + trimmed;
      return proxyBase + encodeURIComponent(full) + extra;
    }
    return line;
  }).join("\n");
}

const port = Number(Deno.env.get("PORT")) || 8080;

Deno.serve({ port, hostname: "0.0.0.0" }, async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("Proxy is running. Use ?url=YOUR_URL", { status: 200, headers: corsHeaders });
    }

    const upstreamHeaders = new Headers();
    upstreamHeaders.set("User-Agent", url.searchParams.get("ua") || DEFAULT_UA);
    const range = req.headers.get("range");
    if (range) upstreamHeaders.set("range", range);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: upstreamHeaders,
    });

    const contentType = response.headers.get("content-type") || "";

    if (targetUrl.includes(".mpd") || targetUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("dash+xml")) {
      const text = await response.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const proxyBase = `${url.origin}${url.pathname}?url=`;
      const extra = extraParams(url.searchParams);
      
      const rewritten = (targetUrl.includes(".mpd") || contentType.includes("dash+xml"))
        ? rewriteDASH(text, baseUrl, proxyBase, extra)
        : rewriteHLS(text, baseUrl, proxyBase, extra);

      return new Response(rewritten, {
        headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "no-cache" }
      });
    }

    const outHeaders = new Headers(corsHeaders);
    if (contentType) outHeaders.set("Content-Type", contentType);
    if (response.headers.get("content-length")) outHeaders.set("Content-Length", response.headers.get("content-length")!);
    if (response.headers.get("content-range")) outHeaders.set("Content-Range", response.headers.get("content-range")!);

    return new Response(response.body, {
      status: response.status,
      headers: outHeaders
    });

  } catch (error) {
    return new Response(error.message, { status: 500, headers: corsHeaders });
  }
});
