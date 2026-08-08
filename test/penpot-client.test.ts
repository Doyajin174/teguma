/**
 * Penpot client 파싱 헬퍼 단위 테스트 (live smoke 실측 2026-08-08 반영).
 *
 * - get-file 응답: data.pages는 페이지 id 배열, 이름·객체는 data.pagesIndex
 * - 페이지 루트 객체 id는 페이지 id가 아니라 고정 root UUID인 인스턴스 존재
 * RPC 호출 없이 순수 함수만 검증한다 (명세 14.2 — RPC는 mock 경계).
 */

import { describe, expect, it } from "vitest";
import { filePagesFromIndex, resolvePageRootId } from "../src/penpot/client.js";

describe("penpot client 파싱 헬퍼", () => {
  it("filePagesFromIndex: pagesIndex → {id, name} 목록 (name 보존)", () => {
    const index = {
      "page-a": { id: "page-a", name: "Page 1", objects: {} },
      "page-b": { id: "page-b", name: "od-handoff-3830495a6aa9-ae9219aad83a", objects: {} },
    };
    expect(filePagesFromIndex(index)).toEqual([
      { id: "page-a", name: "Page 1" },
      { id: "page-b", name: "od-handoff-3830495a6aa9-ae9219aad83a" },
    ]);
  });

  it("filePagesFromIndex: 빈·비객체 입력은 []", () => {
    expect(filePagesFromIndex(undefined)).toEqual([]);
    expect(filePagesFromIndex(null)).toEqual([]);
    expect(filePagesFromIndex("nope")).toEqual([]);
    expect(filePagesFromIndex({})).toEqual([]);
  });

  it("resolvePageRootId: 페이지 id가 객체 키면 그것을 사용한다", () => {
    const objects = { "page-1": { id: "page-1" } };
    expect(resolvePageRootId(objects, "page-1")).toBe("page-1");
  });

  it("resolvePageRootId: 페이지 id가 키가 아니면 고정 root UUID로 폴백한다 (실측)", () => {
    const objects = { "00000000-0000-0000-0000-000000000000": { id: "root" } };
    expect(resolvePageRootId(objects, "page-1")).toBe("00000000-0000-0000-0000-000000000000");
  });
});
