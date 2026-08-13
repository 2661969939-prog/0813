/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  UPLOADS?: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

type SharedCase = {
  id: string;
  org: string;
  createdBy?: string;
  shareWithOrganization?: boolean;
  [key: string]: unknown;
};

function withApiCors(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, PUT, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, x-file-name, x-ovary-role, x-ovary-organization, x-ovary-user",
  );
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestIdentity(request: Request) {
  return {
    role: request.headers.get("x-ovary-role") || "uploader",
    organization: request.headers.get("x-ovary-organization") || "",
    username: request.headers.get("x-ovary-user") || "",
  };
}

function canAccessCase(item: SharedCase, identity: ReturnType<typeof requestIdentity>) {
  if (identity.role === "platform_admin") return true;
  if (item.org !== identity.organization) return false;
  if (identity.role !== "uploader") return true;
  return item.createdBy === identity.username || item.shareWithOrganization === true;
}

async function ensureSharedStateTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS shared_case_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function readSharedCases(env: Env): Promise<SharedCase[]> {
  await ensureSharedStateTable(env);
  const row = await env.DB.prepare("SELECT payload FROM shared_case_state WHERE id = ?")
    .bind("cases")
    .first<{ payload: string }>();
  if (!row?.payload) return [];
  try {
    const parsed = JSON.parse(row.payload);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeSharedCases(env: Env, cases: SharedCase[]) {
  const updatedAt = new Date().toISOString();
  await ensureSharedStateTable(env);
  await env.DB.prepare(`
    INSERT INTO shared_case_state (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).bind("cases", JSON.stringify(cases), updatedAt).run();
  return updatedAt;
}

async function handleSharedCases(request: Request, env: Env) {
  const identity = requestIdentity(request);
  const stored = await readSharedCases(env);
  if (request.method === "GET") {
    return Response.json({
      cases: stored.filter((item) => canAccessCase(item, identity)),
      updatedAt: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  }
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  const body = await request.json<{ cases?: SharedCase[] }>();
  const incoming = Array.isArray(body.cases) ? body.cases.filter((item) => item?.id && item?.org) : [];
  const merged = new Map(identity.role === "platform_admin" ? [] : stored.map((item) => [item.id, item]));
  incoming.forEach((item) => {
    const previous = merged.get(item.id);
    const allowed = identity.role === "platform_admin"
      || (item.org === identity.organization
        && identity.role !== "uploader")
      || (item.org === identity.organization
        && identity.role === "uploader"
        && (item.createdBy === identity.username || previous?.shareWithOrganization === true));
    if (allowed) merged.set(item.id, item);
  });
  const allCases = [...merged.values()];
  const updatedAt = await writeSharedCases(env, allCases);
  return Response.json({
    cases: allCases.filter((item) => canAccessCase(item, identity)),
    updatedAt,
  });
}

async function handleSharedFile(request: Request, env: Env, fileId: string) {
  if (!env.UPLOADS) {
    return Response.json(
      {
        error: "cloud_file_storage_disabled",
        message: "严格免费模式未启用云端文件存储；文件仅保存在当前浏览器。",
      },
      { status: 503 },
    );
  }
  const key = `shared/${fileId}`;
  if (request.method === "PUT") {
    const identity = requestIdentity(request);
    if (!identity.organization || !identity.username) return new Response("Missing identity", { status: 400 });
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 600 * 1024 * 1024) return new Response("File too large", { status: 413 });
    const encodedFilename = request.headers.get("x-file-name") || fileId;
    let filename = encodedFilename;
    try {
      filename = decodeURIComponent(encodedFilename);
    } catch {
      filename = fileId;
    }
    await env.UPLOADS.put(key, request.body, {
      httpMetadata: {
        contentType: request.headers.get("content-type") || "application/octet-stream",
        contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
      customMetadata: {
        organization: identity.organization,
        uploadedBy: identity.username,
      },
    });
    return Response.json({ url: `/api/shared-files/${encodeURIComponent(fileId)}` });
  }
  if (request.method === "GET") {
    const object = await env.UPLOADS.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=60");
    return new Response(object.body, { headers });
  }
  return new Response("Method not allowed", { status: 405 });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") {
      return withApiCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === "/api/shared-cases") {
      return withApiCors(await handleSharedCases(request, env));
    }

    if (url.pathname.startsWith("/api/shared-files/")) {
      const fileId = decodeURIComponent(url.pathname.slice("/api/shared-files/".length));
      return withApiCors(await handleSharedFile(request, env, fileId));
    }

    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
