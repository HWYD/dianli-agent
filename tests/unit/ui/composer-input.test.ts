import { describe, expect, it } from "vitest";

import { getComposerTextareaHeight, shouldSubmitComposerOnEnter } from "@/lib/ui/composer-input";

describe("composer input behavior", () => {
  it("普通 Enter 应提交，Shift + Enter 与输入法组合态应保留换行或候选确认", () => {
    expect(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    expect(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    expect(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("输入框高度应限制在 38px 到 100px 之间", () => {
    expect(getComposerTextareaHeight(20)).toBe(38);
    expect(getComposerTextareaHeight(64)).toBe(64);
    expect(getComposerTextareaHeight(140)).toBe(100);
  });
});
