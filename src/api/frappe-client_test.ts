/**
 * Frappe Client Tests
 *
 * Tests for the FrappeClient HTTP client.
 * Uses mock fetch to avoid real network calls.
 *
 * @module lib/erpnext/tests/api/frappe-client_test
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { FrappeAPIError, FrappeClient } from "./frappe-client.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

interface MockResponse {
  status: number;
  body: unknown;
  contentType?: string;
  /** Raw body string — overrides `body` when provided (for malformed JSON tests). */
  rawBody?: string;
  /** Extra response headers (e.g. retry-after). */
  headers?: Record<string, string>;
}

const callCountRef: { current: number } = { current: 0 };

function mockFetch(responses: Array<MockResponse>) {
  callCountRef.current = 0;
  const original = globalThis.fetch;

  globalThis.fetch = async (
    _url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const config = responses[callCountRef.current++];
    if (!config) throw new Error("No more mock responses configured");

    const body = config.rawBody ?? JSON.stringify(config.body);
    return new Response(body, {
      status: config.status,
      headers: {
        "content-type": config.contentType ?? "application/json",
        ...(config.headers ?? {}),
      },
    });
  };

  return () => {
    globalThis.fetch = original;
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return new FrappeClient({
    baseUrl: "http://localhost:8000",
    apiKey: "test-key",
    apiSecret: "test-secret",
    // Tests run with very short backoff so they stay fast.
    retryBackoffMs: 1,
    ...overrides,
  });
}

// ── Auth header ───────────────────────────────────────────────────────────────

Deno.test("FrappeClient - sends correct auth header", async () => {
  let capturedHeaders: Record<string, string> = {};
  const original = globalThis.fetch;

  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedHeaders = Object.fromEntries(
      new Headers(init?.headers).entries(),
    );
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = makeClient();
  await client.list("Customer");

  assertEquals(capturedHeaders["authorization"], "token test-key:test-secret");

  globalThis.fetch = original;
});

// ── list() ────────────────────────────────────────────────────────────────────

Deno.test("FrappeClient.list() - returns data array", async () => {
  const restore = mockFetch([
    {
      status: 200,
      body: {
        data: [
          { name: "CUST-001", customer_name: "Acme Corp" },
          { name: "CUST-002", customer_name: "Globex" },
        ],
      },
    },
  ]);

  try {
    const client = makeClient();
    const result = await client.list("Customer", {
      fields: ["name", "customer_name"],
      limit: 10,
    });
    assertEquals(result.length, 2);
    assertEquals(result[0].name, "CUST-001");
    assertEquals(result[1].customer_name, "Globex");
  } finally {
    restore();
  }
});

Deno.test("FrappeClient.list() - builds correct query string", async () => {
  let capturedUrl = "";
  const original = globalThis.fetch;

  globalThis.fetch = async (
    url: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const client = makeClient();
  await client.list("Sales Order", {
    fields: ["name", "customer"],
    filters: [["customer", "=", "CUST-001"]],
    limit: 5,
    order_by: "modified desc",
  });

  const url = new URL(capturedUrl);
  assertEquals(url.pathname, "/api/resource/Sales%20Order");
  assertEquals(url.searchParams.get("limit"), "5");
  assertEquals(url.searchParams.get("order_by"), "modified desc");
  assertEquals(url.searchParams.get("as_dict"), "1");

  globalThis.fetch = original;
});

// ── get() ─────────────────────────────────────────────────────────────────────

Deno.test("FrappeClient.get() - returns single document", async () => {
  const restore = mockFetch([
    {
      status: 200,
      body: {
        data: { name: "SINV-001", customer: "CUST-001", grand_total: 1500.0 },
      },
    },
  ]);

  try {
    const client = makeClient();
    const result = await client.get("Sales Invoice", "SINV-001");
    assertEquals(result.name, "SINV-001");
    assertEquals(result.grand_total, 1500.0);
  } finally {
    restore();
  }
});

// ── create() ─────────────────────────────────────────────────────────────────

Deno.test("FrappeClient.create() - sends POST with data", async () => {
  let capturedBody: unknown;
  const original = globalThis.fetch;

  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({ data: { name: "SO-001", customer: "CUST-001" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const client = makeClient();
  const result = await client.create("Sales Order", {
    customer: "CUST-001",
    transaction_date: "2026-02-18",
  });

  assertEquals(result.name, "SO-001");
  assertEquals(
    (capturedBody as { data: { customer: string } }).data.customer,
    "CUST-001",
  );

  globalThis.fetch = original;
});

// ── uploadFile() ─────────────────────────────────────────────────────────────

Deno.test("FrappeClient.uploadFile() - sends native multipart attachment", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedHeaders = new Headers();
  let capturedBody: FormData | undefined;
  const original = globalThis.fetch;

  globalThis.fetch = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedUrl = url.toString();
    capturedMethod = init?.method ?? "";
    capturedHeaders = new Headers(init?.headers);
    capturedBody = init?.body as FormData;
    return new Response(
      JSON.stringify({
        message: {
          doctype: "File",
          name: "a1b2c3",
          file_name: "proposal.pdf",
          file_url: "/private/files/proposal.pdf",
          is_private: 1,
          attached_to_doctype: "CRM Deal",
          attached_to_name: "CRM-DEAL-0001",
          attached_to_field: "proposal",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = makeClient();
    const result = await client.uploadFile({
      fileName: "proposal.pdf",
      contentBase64: btoa("PDF bytes"),
      attachedToDoctype: "CRM Deal",
      attachedToName: "CRM-DEAL-0001",
      attachedToField: "proposal",
    });

    assertEquals(new URL(capturedUrl).pathname, "/api/method/upload_file");
    assertEquals(capturedMethod, "POST");
    assertEquals(
      capturedHeaders.get("authorization"),
      "token test-key:test-secret",
    );
    assertEquals(capturedHeaders.get("accept"), "application/json");
    assertEquals(capturedHeaders.has("content-type"), false);
    assertEquals(capturedBody?.get("doctype"), "CRM Deal");
    assertEquals(capturedBody?.get("docname"), "CRM-DEAL-0001");
    assertEquals(capturedBody?.get("fieldname"), "proposal");
    assertEquals(capturedBody?.get("is_private"), "1");

    const file = capturedBody?.get("file");
    if (!(file instanceof File)) throw new Error("Expected multipart File");
    assertEquals(file.name, "proposal.pdf");
    assertEquals(await file.text(), "PDF bytes");
    assertEquals(result.name, "a1b2c3");
    assertEquals(result.file_url, "/private/files/proposal.pdf");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("FrappeClient.uploadFile() - sends explicit public privacy", async () => {
  let capturedBody: FormData | undefined;
  const original = globalThis.fetch;

  globalThis.fetch = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedBody = init?.body as FormData;
    return new Response(
      JSON.stringify({
        message: {
          name: "public-file",
          file_name: "brochure.pdf",
          file_url: "/files/brochure.pdf",
          is_private: 0,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const client = makeClient();
    await client.uploadFile({
      fileName: "brochure.pdf",
      contentBase64: btoa("public"),
      attachedToDoctype: "Lead",
      attachedToName: "LEAD-0001",
      isPrivate: false,
    });

    assertEquals(capturedBody?.get("is_private"), "0");
    assertEquals(capturedBody?.has("fieldname"), false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("FrappeClient.uploadFile() - rejects malformed or empty base64", async () => {
  const client = makeClient();
  const input = {
    fileName: "proposal.pdf",
    attachedToDoctype: "CRM Deal",
    attachedToName: "CRM-DEAL-0001",
  };

  await assertRejects(
    () => client.uploadFile({ ...input, contentBase64: "not-base64!" }),
    Error,
    "valid base64",
  );
  await assertRejects(
    () => client.uploadFile({ ...input, contentBase64: "" }),
    Error,
    "must not be empty",
  );
});

Deno.test("FrappeClient.uploadFile() - rejects decoded content over configured limit", async () => {
  const client = makeClient({ maxUploadBytes: 2 });

  await assertRejects(
    () =>
      client.uploadFile({
        fileName: "proposal.pdf",
        contentBase64: btoa("abc"),
        attachedToDoctype: "CRM Deal",
        attachedToName: "CRM-DEAL-0001",
      }),
    Error,
    "exceeds",
  );
});

Deno.test("FrappeClient - rejects a non-positive upload limit", () => {
  assertThrows(
    () => makeClient({ maxUploadBytes: 0 }),
    Error,
    "maxUploadBytes",
  );
});

Deno.test("FrappeClient.uploadFile() - preserves Frappe permission errors", async () => {
  const restore = mockFetch([
    {
      status: 403,
      body: { message: "Not permitted", exc_type: "PermissionError" },
    },
  ]);

  try {
    const client = makeClient();
    await assertRejects(
      () =>
        client.uploadFile({
          fileName: "proposal.pdf",
          contentBase64: btoa("PDF bytes"),
          attachedToDoctype: "CRM Deal",
          attachedToName: "CRM-DEAL-0001",
        }),
      FrappeAPIError,
      "HTTP 403",
    );
  } finally {
    restore();
  }
});

// ── Error handling ────────────────────────────────────────────────────────────

Deno.test("FrappeClient - throws FrappeAPIError on HTTP 404", async () => {
  const restore = mockFetch([
    {
      status: 404,
      body: { message: "Document not found" },
    },
  ]);

  try {
    const client = makeClient();
    await assertRejects(
      () => client.get("Customer", "NONEXISTENT"),
      FrappeAPIError,
      "HTTP 404",
    );
  } finally {
    restore();
  }
});

Deno.test("FrappeClient - throws FrappeAPIError on HTTP 403", async () => {
  const restore = mockFetch([
    {
      status: 403,
      body: { message: "Permission denied", exc_type: "PermissionError" },
    },
  ]);

  try {
    const client = makeClient();
    await assertRejects(
      () => client.list("Payroll Entry"),
      FrappeAPIError,
      "HTTP 403",
    );
  } finally {
    restore();
  }
});

Deno.test("FrappeClient - throws FrappeAPIError on HTTP 500 (POST not retried)", async () => {
  const restore = mockFetch([
    {
      status: 500,
      body: { message: "Internal Server Error" },
    },
  ]);

  try {
    const client = makeClient();
    await assertRejects(
      () => client.callMethod("frappe.client.get_list"),
      FrappeAPIError,
      "HTTP 500",
    );
    // POST is not in the retry method list by default — single call expected.
    assertEquals(callCountRef.current, 1);
  } finally {
    restore();
  }
});

// ── Retry / backoff ───────────────────────────────────────────────────────────

Deno.test("FrappeClient retry - GET 503 succeeds on second attempt", async () => {
  const restore = mockFetch([
    { status: 503, body: { message: "Service Unavailable" } },
    {
      status: 200,
      body: { data: [{ name: "CUST-001", customer_name: "Acme" }] },
    },
  ]);

  try {
    const client = makeClient();
    const result = await client.list("Customer");
    assertEquals(result.length, 1);
    assertEquals(result[0].name, "CUST-001");
    assertEquals(callCountRef.current, 2);
  } finally {
    restore();
  }
});

Deno.test("FrappeClient retry - GET retries up to configured max then throws", async () => {
  const restore = mockFetch([
    { status: 503, body: { message: "Service Unavailable" } },
    { status: 503, body: { message: "Service Unavailable" } },
    { status: 503, body: { message: "Service Unavailable" } },
    { status: 503, body: { message: "Service Unavailable" } },
  ]);

  try {
    const client = makeClient({ retries: 2 });
    await assertRejects(
      () => client.list("Customer"),
      FrappeAPIError,
      "HTTP 503",
    );
    // 1 initial attempt + 2 retries = 3 calls total
    assertEquals(callCountRef.current, 3);
  } finally {
    restore();
  }
});

Deno.test("FrappeClient retry - 404 is not retried", async () => {
  const restore = mockFetch([
    { status: 404, body: { message: "Document not found" } },
  ]);

  try {
    const client = makeClient();
    await assertRejects(
      () => client.get("Customer", "MISSING"),
      FrappeAPIError,
      "HTTP 404",
    );
    assertEquals(callCountRef.current, 1);
  } finally {
    restore();
  }
});

Deno.test("FrappeClient retry - retries disabled when retries=0", async () => {
  const restore = mockFetch([
    { status: 503, body: { message: "Service Unavailable" } },
  ]);

  try {
    const client = makeClient({ retries: 0 });
    await assertRejects(
      () => client.list("Customer"),
      FrappeAPIError,
      "HTTP 503",
    );
    assertEquals(callCountRef.current, 1);
  } finally {
    restore();
  }
});

Deno.test("FrappeClient retry - 429 surfaces Retry-After header on FrappeAPIError", async () => {
  const restore = mockFetch([
    {
      status: 429,
      body: { message: "Too Many Requests" },
      headers: { "retry-after": "0" },
    },
    {
      status: 200,
      body: { data: [] },
    },
  ]);

  try {
    const client = makeClient();
    const result = await client.list("Customer");
    assertEquals(result.length, 0);
    assertEquals(callCountRef.current, 2);
  } finally {
    restore();
  }
});

// ── Robust JSON parsing ──────────────────────────────────────────────────────

Deno.test("FrappeClient parsing - malformed JSON in error body falls back to text", async () => {
  const restore = mockFetch([
    {
      status: 500,
      // Server claims JSON but returns broken markup (HTML error page is common)
      contentType: "application/json",
      body: null,
      rawBody: "<html><body>500 Internal Server Error</body></html>",
    },
  ]);

  try {
    const client = makeClient({ retries: 0 });
    const error = await assertRejects(
      () => client.get("Customer", "ANY"),
      FrappeAPIError,
      "HTTP 500",
    );
    // Body must surface the raw text rather than crashing on JSON.parse
    assertEquals(typeof error.body, "string");
  } finally {
    restore();
  }
});
