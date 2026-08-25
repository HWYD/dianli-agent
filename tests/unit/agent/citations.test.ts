import { describe, expect, it } from "vitest";

import { findUnknownEvidenceIds } from "@/lib/agent/citations";

describe("Evidence 引用校验", () => {
  it("只标记正文中不存在于本轮 Evidence 的引用，并去重", () => {
    expect(findUnknownEvidenceIds("T06 已停机 [E1]，请核实 [E9]。重复 [E9]。", ["E1", "E2"])).toEqual(["E9"]);
  });

  it("忽略没有引用编号的普通正文", () => {
    expect(findUnknownEvidenceIds("现有资料无法确认，需要现场核实。", ["E1"])).toEqual([]);
  });
});
