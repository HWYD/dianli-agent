import { describe, expect, it } from "vitest";

import { publicAssessmentQuestions, selectRecommendedQuestions } from "@/lib/ui/recommended-questions";

describe("selectRecommendedQuestions", () => {
  it("每个回答应返回三道互不重复的公开考察题", () => {
    const recommendations = selectRecommendedQuestions("assistant-message-001");

    expect(recommendations).toHaveLength(3);
    expect(new Set(recommendations)).toHaveLength(3);
    expect(recommendations.every((question) => publicAssessmentQuestions.includes(question))).toBe(true);
  });

  it("同一回答的推荐结果应保持稳定，并排除刚刚提问的题目", () => {
    const currentQuestion = publicAssessmentQuestions[0];

    expect(selectRecommendedQuestions("assistant-message-002", currentQuestion)).toEqual(
      selectRecommendedQuestions("assistant-message-002", currentQuestion),
    );
    expect(selectRecommendedQuestions("assistant-message-002", currentQuestion)).not.toContain(currentQuestion);
  });
});
