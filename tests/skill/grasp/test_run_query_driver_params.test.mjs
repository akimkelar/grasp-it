/**
 * Tests for the neo4j-driver code path in run-query.mjs.
 *
 * Why this file exists:
 * The existing tests/skill/grasp/test_run_query_params.test.mjs exercises the
 * driver path via subprocess (spawnSync) with NEO4J_TEST_MOCK=1, which throws
 * before session.run is called. That proves the args parsing and graceful
 * skip paths but cannot verify that the params bag is actually forwarded to
 * `session.run(query, params)`.
 *
 * This file imports run-query.mjs directly and calls runQueryViaDriver()
 * with an injected fake `neo4j` module so we can inspect every call made on
 * the session object — most importantly the arguments to session.run.
 *
 * To allow in-process testing without changing the script's CLI behavior,
 * run-query.mjs guards its main() block with an isEntrypoint check (the
 * standard ES-module pattern: process.argv[1] === import.meta.url). When
 * imported here, isEntrypoint is false and main() does not run, so we can
 * call runQueryViaDriver() as a plain function.
 *
 * runQueryViaDriver accepts an optional injection seam (the fourth
 * argument, `_neo4j`). Production callers omit it; tests pass a fake
 * module that records session.run arguments.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { runQueryViaDriver } = await import(
  '../../../grasp-it-plugin/skills/grasp/run-query.mjs'
);

// ── Fake neo4j driver ──────────────────────────────────────────────────────────
// We build a fake driver that records every call into a shared `calls` array,
// then return canned records from session.run().

function makeFakeNeo4j() {
  const calls = {
    driver: [],
    session: [],
    run: [],
    close: [],
    sessionClose: [],
  };

  const fakeNeo4j = {
    driver: (uri, auth) => {
      calls.driver.push({
        uri,
        auth: { user: auth?.principal, password: auth?.credentials },
      });
      return {
        session: (opts) => {
          calls.session.push(opts);
          return {
            run: async (query, params) => {
              calls.run.push({ query, params });
              return {
                records: [
                  {
                    keys: ['n'],
                    get: (k) => 'value-from-mock',
                  },
                ],
              };
            },
            close: async () => {
              calls.sessionClose.push(true);
            },
          };
        },
        close: async () => {
          calls.close.push(true);
        },
      };
    },
    auth: {
      basic: (username, password) => ({
        principal: username,
        credentials: password,
        scheme: 'basic',
      }),
    },
  };

  return { fakeNeo4j, calls };
}

const NEO4J_CONFIG = {
  NEO4J_URI: 'bolt://test.example:7687',
  NEO4J_USERNAME: 'tester',
  NEO4J_PASSWORD: 'sekret',
  NEO4J_DATABASE: 'grasp-test',
};

let fakeNeo4j;
let calls;

beforeEach(() => {
  ({ fakeNeo4j, calls } = makeFakeNeo4j());
});

describe('run-query.mjs — driver path (params forwarding)', () => {
  it('calls session.run with the params bag (not inlined into the query)', async () => {
    const query = 'MATCH (f:File {analyzedAtCommit: $currentCommit}) RETURN f';
    const params = { currentCommit: 'abc123def' };

    const result = await runQueryViaDriver(NEO4J_CONFIG, query, params, fakeNeo4j);

    // The run-query.mjs API contract: returns { ok, records }.
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual({ n: 'value-from-mock' });

    // session.run was called exactly once with the original query AND
    // the params bag — proving the params are forwarded, not interpolated.
    expect(calls.run).toHaveLength(1);
    expect(calls.run[0].query).toBe(query);
    expect(calls.run[0].params).toEqual({ currentCommit: 'abc123def' });
  });

  it('forwards multi-entry params bags with mixed types', async () => {
    const query = 'MATCH (n) WHERE n.commit = $currentCommit AND n.limit = $limit RETURN n';
    const params = {
      currentCommit: 'deadbeef',
      limit: 50,
      includeTypes: ['feature', 'operation'],
    };

    const result = await runQueryViaDriver(NEO4J_CONFIG, query, params, fakeNeo4j);

    expect(result.ok).toBe(true);
    expect(calls.run[0].query).toBe(query);
    expect(calls.run[0].params).toEqual(params);
  });

  it('passes empty params when params arg is omitted (backward compat)', async () => {
    const query = 'MATCH (n) RETURN n LIMIT 1';

    // Call WITHOUT a params arg. Default in the function signature is `{}`.
    const result = await runQueryViaDriver(NEO4J_CONFIG, query, undefined, fakeNeo4j);

    expect(result.ok).toBe(true);
    expect(calls.run[0].query).toBe(query);
    // Backward-compat: callers who never passed params still get an empty
    // object bag at session.run — not undefined — so the driver doesn't
    // choke on the missing second argument.
    expect(calls.run[0].params).toEqual({});
  });

  it('uses the configured URI and database', async () => {
    const result = await runQueryViaDriver(
      NEO4J_CONFIG,
      'MATCH (n) RETURN n',
      {},
      fakeNeo4j,
    );

    expect(result.ok).toBe(true);
    expect(calls.driver[0].uri).toBe('bolt://test.example:7687');
    expect(calls.driver[0].auth.user).toBe('tester');
    expect(calls.driver[0].auth.password).toBe('sekret');
    expect(calls.session[0]).toEqual({ database: 'grasp-test' });
  });

  it('closes the session and driver after a successful run', async () => {
    await runQueryViaDriver(NEO4J_CONFIG, 'MATCH (n) RETURN n', {}, fakeNeo4j);

    // The session and driver must both close so we don't leak sockets.
    expect(calls.sessionClose).toHaveLength(1);
    expect(calls.close).toHaveLength(1);
  });

  it('signals fallback (ok=false) when neo4j-driver is not available', async () => {
    // Pass a neo4j mock whose driver() throws — simulates "package not
    // installed" or "connection refused" pre-driver-creation.
    const brokenNeo4j = {
      driver: () => { throw new Error('Cannot find module neo4j-driver'); },
      auth: { basic: () => ({}) },
    };

    const result = await runQueryViaDriver(
      NEO4J_CONFIG,
      'MATCH (n) RETURN n',
      { currentCommit: 'abc' },
      brokenNeo4j,
    );

    expect(result.ok).toBe(false);
    expect(result.fallback).toBe(true);
  });
});
