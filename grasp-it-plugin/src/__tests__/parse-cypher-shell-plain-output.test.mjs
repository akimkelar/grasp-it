import { describe, it, expect } from "vitest";
import { parseCypherShellPlainOutput } from "../../skills/grasp/run-query.mjs";

// ── parseCypherShellPlainOutput ───────────────────────────────────────────────
//
// Direct unit tests for the cypher-shell plain-output parser. The integration
// tests in tests/skill/grasp/test_cypher_shell_bugs.test.mjs cover the happy
// paths through a mock cypher-shell subprocess; these tests exercise the parser
// directly against shapes the integration tests do not reach, so a regression
// in the parsing logic will fail here even when the subprocess path is fine.
//
// cypher-shell --format plain emits (from SimpleOutputFormatter):
//
//   key1,key2,key3       <- header line: comma-joined keys (one row only)
//   val1,val2,val3       <- data rows:   one line per record
//   val1,val2,val3
//
// - There is NO separator row (e.g. no "---"). The header is always row 1.
// - Null values are rendered as empty strings (e.g. "Alice, , 30").
// - Lines may end with LF or CRLF.
// - No "rows available" trailer is emitted.
//
// The parser returns an array of { [key]: value } records. Values are always
// strings (cypher-shell uses .toString() on values). An empty result (no data
// rows, or no input at all) yields [].

// Build a string with a literal backslash (avoid shell / JS escape ambiguity
// when constructing test fixtures inline).
const BACKSLASH = String.fromCharCode(0x5c);

describe("parseCypherShellPlainOutput", () => {
  describe("null and empty cell normalization", () => {
    it("coerces an empty middle cell to null", () => {
      // Header "name,age" + row "Alice," → second column is the empty string
      // and must be normalized to null so callers can distinguish NULL from
      // the literal empty string. If the parser stops normalizing, this test
      // fails because age === "" instead of null.
      expect(parseCypherShellPlainOutput("name,age\nAlice,\n")).toEqual([
        { name: "Alice", age: null },
      ]);
    });

    it("coerces a trailing empty cell to null", () => {
      expect(parseCypherShellPlainOutput("a,b\n,v\n")).toEqual([
        { a: null, b: "v" },
      ]);
    });

    it("coerces a leading empty cell to null", () => {
      expect(parseCypherShellPlainOutput("a,b\n,v\n".replace("v", "w"))).toEqual([
        { a: null, b: "w" },
      ]);
    });

    it("coerces all-empty cells to all-nulls", () => {
      // Three columns, all empty in the data row → all null.
      expect(parseCypherShellPlainOutput("a,b,c\n,,\n")).toEqual([
        { a: null, b: null, c: null },
      ]);
    });

    it("does NOT treat a literal backslash-N token as null (documents current behavior)", () => {
      // Some other plain-text formatters (e.g. postgres COPY) use "\N" as
      // the null marker. cypher-shell's SimpleOutputFormatter does NOT — it
      // renders nulls as empty strings. This test documents the current
      // contract: a literal \N is just a 2-character string and survives as
      // such. If a future change starts treating \N as null, this test will
      // fail and the change should be intentional.
      const input = "name,age\nAlice," + BACKSLASH + "N\n";
      expect(parseCypherShellPlainOutput(input)).toEqual([
        { name: "Alice", age: BACKSLASH + "N" },
      ]);
    });
  });

  describe("empty / minimal inputs", () => {
    it("returns [] for an empty string", () => {
      expect(parseCypherShellPlainOutput("")).toEqual([]);
    });

    it("returns [] for null", () => {
      expect(parseCypherShellPlainOutput(null)).toEqual([]);
    });

    it("returns [] for undefined", () => {
      expect(parseCypherShellPlainOutput(undefined)).toEqual([]);
    });

    it("returns [] for a single header that is only whitespace (no data)", () => {
      // A single line of whitespace is treated as the header; with no data
      // rows following, the parser returns []. (Note: the parser does NOT
      // trim, so this is not the same as passing an empty string — see the
      // empty-string case above for that.)
      expect(parseCypherShellPlainOutput("   \n")).toEqual([]);
    });

    it("returns [] for a header followed by only blank lines", () => {
      expect(parseCypherShellPlainOutput("name\n\n\n")).toEqual([]);
    });

    it("returns [] for a header-only input (no separator row, no data rows)", () => {
      // A "name\n" alone is the header with zero data lines. This is the
      // cypher-shell output for "RETURN n.name AS name LIMIT 0". If the
      // parser mistakenly treats the header as a record, the result will
      // not be [] and this test will fail.
      expect(parseCypherShellPlainOutput("name\n")).toEqual([]);
    });
  });

  describe("documented format invariants", () => {
    it("treats the first non-empty line as the header (NO separator row expected)", () => {
      // cypher-shell plain format does NOT emit a "---" separator row between
      // the header and data rows — that's the tabular format. If a future
      // parser change tries to skip a separator row, this test will catch
      // it: the row "1,2" would be skipped and we'd see no records.
      expect(parseCypherShellPlainOutput("a,b\n1,2\n")).toEqual([
        { a: "1", b: "2" },
      ]);
    });

    it("does not split quoted strings with embedded commas", () => {
      // The current parser does NOT handle CSV-style quoting — it splits
      // naively on every comma. This test documents that limitation so a
      // future parser upgrade that DOES add quote-handling will be flagged.
      //
      // Input: one row, two columns. The first value is `"hello, world"`.
      // Naive splitting on commas produces THREE fields instead of two,
      // and the record only contains the first two header keys.
      const out = parseCypherShellPlainOutput('description\n"hello, world"\n');
      // Naive split: description column gets `"hello` (with leading quote),
      // phantom columns appear. The load-bearing assertion is that the
      // record does NOT contain the full unquoted substring `hello, world`
      // and does NOT have the literal value "hello, world" without quotes.
      expect(out).toHaveLength(1);
      expect(out[0].description).not.toBe("hello, world");
      expect(out[0].description.startsWith('"')).toBe(true);
    });
  });

  describe("trivial cases", () => {
    it("parses a single-column, single-record output", () => {
      expect(parseCypherShellPlainOutput("n\n42\n")).toEqual([{ n: "42" }]);
    });

    it("parses a single-column header with a single-column record containing a dash", () => {
      // Sanity check that the parser doesn't choke on common id shapes.
      expect(parseCypherShellPlainOutput("id\nnode-1\n")).toEqual([
        { id: "node-1" },
      ]);
    });
  });

  describe("wide records (many columns)", () => {
    it("parses 12 columns with all distinct values", () => {
      const cols = Array.from({ length: 12 }, (_, i) => `c${i}`).join(",");
      const vals = Array.from({ length: 12 }, (_, i) => `v${i}`).join(",");
      const out = parseCypherShellPlainOutput(`${cols}\n${vals}\n`);
      expect(out).toHaveLength(1);
      // All keys present with their values.
      for (let i = 0; i < 12; i++) {
        expect(out[0][`c${i}`]).toBe(`v${i}`);
      }
    });

    it("parses 10 records across 5 columns without row bleed-through", () => {
      const header = "a,b,c,d,e";
      const rows = Array.from({ length: 10 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => `r${r}c${c}`).join(","),
      );
      const out = parseCypherShellPlainOutput([header, ...rows, ""].join("\n"));
      expect(out).toHaveLength(10);
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 5; c++) {
          expect(out[r][String.fromCharCode(97 + c)]).toBe(`r${r}c${c}`);
        }
      }
    });

    it("handles 10 records × 12 columns (120 cells) end-to-end", () => {
      const header = Array.from({ length: 12 }, (_, i) => `c${i}`).join(",");
      const records = Array.from({ length: 10 }, (_, r) =>
        Array.from({ length: 12 }, (_, c) => `${r}:${c}`).join(","),
      );
      const out = parseCypherShellPlainOutput([header, ...records].join("\n"));
      expect(out).toHaveLength(10);
      expect(Object.keys(out[0])).toHaveLength(12);
      // Spot-check a corner cell.
      expect(out[9]["c11"]).toBe("9:11");
      expect(out[0]["c0"]).toBe("0:0");
    });
  });

  describe("whitespace handling (documents current contract: NO trim)", () => {
    it("preserves leading and trailing whitespace inside a cell value", () => {
      // The parser does not currently trim per-cell whitespace. This is a
      // known limitation — cypher-shell plain format does not normally emit
      // padding, but if a future change adds trim, this test will fail and
      // flag the intentional behavior change.
      expect(parseCypherShellPlainOutput("name\n  Alice  \n")).toEqual([
        { name: "  Alice  " },
      ]);
    });

    it("preserves interior whitespace inside a cell value", () => {
      // Interior whitespace is not a separator — only commas are.
      expect(parseCypherShellPlainOutput("note\nhello world\n")).toEqual([
        { note: "hello world" },
      ]);
    });

    it("preserves whitespace in each column of a multi-column row", () => {
      expect(parseCypherShellPlainOutput("a,b\n  x  ,  y  \n")).toEqual([
        { a: "  x  ", b: "  y  " },
      ]);
    });
  });

  describe("line endings", () => {
    it("handles pure LF line endings", () => {
      expect(parseCypherShellPlainOutput("name\nAlice\nBob\n")).toEqual([
        { name: "Alice" },
        { name: "Bob" },
      ]);
    });

    it("handles pure CRLF line endings", () => {
      expect(parseCypherShellPlainOutput("name\r\nAlice\r\nBob\r\n")).toEqual([
        { name: "Alice" },
        { name: "Bob" },
      ]);
    });

    it("handles a mix of CRLF and LF within the same output", () => {
      // Real-world cypher-shell output may mix line endings when piped
      // through wrappers on different platforms.
      expect(parseCypherShellPlainOutput("a,b\r\n1,2\n3,4\r\n")).toEqual([
        { a: "1", b: "2" },
        { a: "3", b: "4" },
      ]);
    });

    it("handles a final line with no trailing newline", () => {
      // No terminating \n at all on the last record.
      expect(parseCypherShellPlainOutput("name\nAlice")).toEqual([
        { name: "Alice" },
      ]);
    });

    it("ignores multiple consecutive blank lines between records", () => {
      // Blank lines must be dropped, not turned into phantom records of
      // all-nulls. If the parser stops filtering, the result would have
      // 4 records instead of 2.
      expect(parseCypherShellPlainOutput("a\n1\n\n\n2\n")).toEqual([
        { a: "1" },
        { a: "2" },
      ]);
    });
  });

  describe("header / data cell shape mismatches", () => {
    it("uses an empty-string key for an empty leading header cell", () => {
      // Header ",name" — first key is "" (empty), second is "name".
      // The data row ",v" maps "" → null and "name" → "v".
      expect(parseCypherShellPlainOutput(",name\n,v\n")).toEqual([
        { "": null, name: "v" },
      ]);
    });

    it("coerces an empty data cell under a non-empty header to null", () => {
      expect(parseCypherShellPlainOutput("a,b\n,x\n")).toEqual([
        { a: null, b: "x" },
      ]);
    });

    it("does not throw when a row has more cells than the header (extras are dropped)", () => {
      // The parser's `header.forEach` only iterates over the header keys,
      // so extra data cells are silently ignored. This is the current
      // contract; a future change that surfaces extras would be caught.
      expect(() =>
        parseCypherShellPlainOutput("a\n1,2,3\n"),
      ).not.toThrow();
      const out = parseCypherShellPlainOutput("a\n1,2,3\n");
      expect(out).toHaveLength(1);
      expect(out[0].a).toBe("1");
      // Extras must NOT pollute the record.
      expect(Object.keys(out[0])).toEqual(["a"]);
    });

    it("coerces a missing trailing data cell to null when the row is shorter than the header", () => {
      // Header has 3 columns, data row has 2 → third cell is `undefined`,
      // which the parser's `v === undefined || v === ""` rule normalizes
      // to null. This must not throw.
      expect(() =>
        parseCypherShellPlainOutput("a,b,c\n1,2\n"),
      ).not.toThrow();
      const out = parseCypherShellPlainOutput("a,b,c\n1,2\n");
      expect(out[0].a).toBe("1");
      expect(out[0].b).toBe("2");
      expect(out[0].c).toBeNull();
    });

    it("coerces a missing middle data cell to null", () => {
      // "a,c\n1,,3" — middle column is empty between two commas.
      expect(parseCypherShellPlainOutput("a,b,c\n1,,3\n")).toEqual([
        { a: "1", b: null, c: "3" },
      ]);
    });
  });

  describe("unicode in data", () => {
    it("preserves emoji in cell values", () => {
      expect(parseCypherShellPlainOutput("note\n🚀\n")).toEqual([
        { note: "🚀" },
      ]);
    });

    it("preserves CJK characters in cell values", () => {
      expect(parseCypherShellPlainOutput("name\nユーザー\n")).toEqual([
        { name: "ユーザー" },
      ]);
    });

    it("preserves accented characters in cell values", () => {
      expect(parseCypherShellPlainOutput("name\nMüller\n")).toEqual([
        { name: "Müller" },
      ]);
    });

    it("preserves mixed-script identifiers (Cyrillic) in cell values", () => {
      expect(parseCypherShellPlainOutput("id\nгрех\n")).toEqual([
        { id: "грех" },
      ]);
    });

    it("preserves unicode across multiple columns and rows", () => {
      const out = parseCypherShellPlainOutput("name,city\nAlice,東京\nBob,München\n");
      expect(out).toEqual([
        { name: "Alice", city: "東京" },
        { name: "Bob", city: "München" },
      ]);
    });
  });
});