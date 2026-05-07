import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a basic CSV", () => {
    const r = parseCsv("a,b,c\n1,2,3\n4,5,6");
    expect(r.headers).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("handles quoted cells with commas", () => {
    const r = parseCsv(`name,note\n"Smith, Alice","Hi, world"`);
    expect(r.rows[0]).toEqual({ name: "Smith, Alice", note: "Hi, world" });
  });

  it("preserves embedded newlines inside quoted cells", () => {
    const r = parseCsv(`name,bio\nAlice,"Two\nlines"`);
    expect(r.rows[0]).toEqual({ name: "Alice", bio: "Two\nlines" });
  });

  it("unescapes doubled quotes", () => {
    const r = parseCsv(`name,quote\nAlice,"She said ""hi"""`);
    expect(r.rows[0]).toEqual({ name: "Alice", quote: 'She said "hi"' });
  });

  it("treats empty cells as empty strings", () => {
    const r = parseCsv("a,b,c\n1,,3\n,2,");
    expect(r.rows).toEqual([
      { a: "1", b: "", c: "3" },
      { a: "", b: "2", c: "" },
    ]);
  });

  it("handles CRLF line endings", () => {
    const r = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(r.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("skips blank trailing lines", () => {
    const r = parseCsv("a,b\n1,2\n\n");
    expect(r.rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("trims header whitespace", () => {
    const r = parseCsv(" a , b \n1,2");
    expect(r.headers).toEqual(["a", "b"]);
  });

  it("rejects unterminated quoted cells", () => {
    expect(() => parseCsv(`a,b\n"unclosed`)).toThrow(CsvParseError);
  });

  it("rejects duplicate headers", () => {
    expect(() => parseCsv("a,a\n1,2")).toThrow(/Duplicate header/);
  });

  it("rejects all-empty headers", () => {
    expect(() => parseCsv("")).not.toThrow();
    expect(parseCsv("").rows).toEqual([]);
  });

  it("ignores trailing whitespace in cells", () => {
    const r = parseCsv("a,b\n  hi  ,  there  ");
    expect(r.rows[0]).toEqual({ a: "hi", b: "there" });
  });

  it("attaches line number to parse errors", () => {
    try {
      parseCsv(`a,b\n1,2\n"unclosed`);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CsvParseError);
      expect((e as CsvParseError).line).toBe(3);
    }
  });
});
