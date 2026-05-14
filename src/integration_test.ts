/**
 * ERPNext Integration Tests
 *
 * Optional smoke tests that hit a live ERPNext instance to validate the
 * Frappe REST contract end-to-end. Skipped by default — every Deno.test
 * here has `ignore: !runIntegration`, so `deno task test` stays a pure
 * unit-test run unless the operator opts in.
 *
 * Enable:
 *   ERPNEXT_INTEGRATION=1 \
 *   ERPNEXT_URL=http://localhost:8000 \
 *   ERPNEXT_API_KEY=... \
 *   ERPNEXT_API_SECRET=... \
 *   deno task test
 *
 * Tests are deliberately read-only to avoid polluting whatever instance
 * is targeted. Add write/cleanup workflows behind a separate env flag if
 * you need them.
 *
 * @module lib/erpnext/src/integration_test
 */

import { assert, assertEquals } from "@std/assert";
import { FrappeClient } from "./api/frappe-client.ts";

const runIntegration = Deno.env.get("ERPNEXT_INTEGRATION") === "1";

function liveClient(): FrappeClient {
  const baseUrl = Deno.env.get("ERPNEXT_URL");
  const apiKey = Deno.env.get("ERPNEXT_API_KEY");
  const apiSecret = Deno.env.get("ERPNEXT_API_SECRET");
  if (!baseUrl || !apiKey || !apiSecret) {
    throw new Error(
      "Integration tests require ERPNEXT_URL, ERPNEXT_API_KEY and " +
        "ERPNEXT_API_SECRET. Either set them or unset ERPNEXT_INTEGRATION " +
        "to skip these tests.",
    );
  }
  return new FrappeClient({
    baseUrl,
    apiKey,
    apiSecret,
    // Integration runs should retry on transient infra hiccups but not
    // mask hard failures, so keep the defaults conservative.
    retries: 2,
  });
}

Deno.test({
  name: "integration: list Customer returns an array",
  ignore: !runIntegration,
  fn: async () => {
    const client = liveClient();
    const customers = await client.list("Customer", {
      fields: ["name"],
      limit: 5,
    });
    assert(Array.isArray(customers));
  },
});

Deno.test({
  name: "integration: list Item returns an array",
  ignore: !runIntegration,
  fn: async () => {
    const client = liveClient();
    const items = await client.list("Item", {
      fields: ["name", "item_code"],
      limit: 5,
    });
    assert(Array.isArray(items));
  },
});

Deno.test({
  name: "integration: get DocType 'Customer' resolves",
  ignore: !runIntegration,
  fn: async () => {
    const client = liveClient();
    const doctype = await client.get("DocType", "Customer");
    assertEquals(doctype.name, "Customer");
  },
});

Deno.test({
  name: "integration: list Sales Invoice (read-only sanity)",
  ignore: !runIntegration,
  fn: async () => {
    const client = liveClient();
    const invoices = await client.list("Sales Invoice", {
      fields: ["name", "grand_total", "docstatus"],
      limit: 3,
    });
    assert(Array.isArray(invoices));
  },
});
