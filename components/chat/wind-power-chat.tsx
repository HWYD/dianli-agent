"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowRight, ChevronDown, Send } from "lucide-react";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import {
  evidencePartDataSchema,
  executionProgressPartDataSchema,
  type Evidence,
  type EvidencePartData,
  type ExecutionProgressPartData,
  scopePartDataSchema,
  type ScopePartData,
  type VerifiedClaim,
} from "../../lib/agent/schemas";
import { findUnknownEvidenceIds } from "../../lib/agent/citations";
import { getEvidenceAnchorId } from "../../lib/ui/evidence-anchors";
import { getComposerTextareaHeight, shouldSubmitComposerOnEnter } from "../../lib/ui/composer-input";
import { getExecutionDisclosureLabel } from "../../lib/ui/execution-disclosure";
import { getRequestExecutionState } from "../../lib/ui/execution-state";
import type { WindPowerUIMessage } from "../../lib/ui/message-types";
import { selectRecommendedQuestions } from "../../lib/ui/recommended-questions";

const exampleQuestions = [
  "查询 T06 的风机型号、最新运行状态和告警时间",
  "分析 T03 的 24002 是否为重复故障，工单应如何调整？",
  "T09 的 24011 已完成工单是否符合关闭要求？",
  "哪些情形禁止远程强制复位？",
];

const answerMarkdownElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const evidenceReferencePattern = /\[(E\d+)\](?!\()/g;
const fencedCodeBlockPattern = /(```[\s\S]*?```)/g;

function prepareEvidenceLinks(markdown: string, knownEvidenceIds: Set<string> | undefined, messageId: string): string {
  if (!knownEvidenceIds || knownEvidenceIds.size === 0) {
    return markdown;
  }

  return markdown
    .split(fencedCodeBlockPattern)
    .map((segment) => {
      if (segment.startsWith("```")) {
        return segment;
      }

      return segment.replace(evidenceReferencePattern, (reference, evidenceId: string) =>
        knownEvidenceIds.has(evidenceId) ? `[\\[${evidenceId}\\]](#${getEvidenceAnchorId(messageId, evidenceId)})` : reference,
      );
    })
    .join("");
}

function transformAnswerUrl(url: string): string | null {
  return url.startsWith("#evidence-") ? url : null;
}

function getText(message: WindPowerUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function getEvidencePart(message: WindPowerUIMessage): EvidencePartData | undefined {
  const part = message.parts.find((item) => item.type === "data-evidence");
  return part?.data;
}

function getProgressPart(message: WindPowerUIMessage): ExecutionProgressPartData | undefined {
  const part = message.parts.find((item) => item.type === "data-progress");
  return part?.data;
}

function getScopePart(message: WindPowerUIMessage): ScopePartData | undefined {
  const part = message.parts.find((item) => item.type === "data-scope");
  return part?.data;
}

function MarkdownAnswer({
  text,
  knownEvidenceIds,
  messageId,
  isAnimating,
}: {
  text: string;
  knownEvidenceIds?: Set<string>;
  messageId: string;
  isAnimating: boolean;
}) {
  return (
    <div className="answer-markdown">
      <Streamdown
        allowedElements={answerMarkdownElements}
        animated={false}
        components={{
          a: ({ children, node: _node, ...props }) => (
            <a {...props} className="evidence-reference" rel={undefined} target={undefined}>
              {children}
            </a>
          ),
          strong: ({ children, node: _node, ...props }) => <strong {...props}>{children}</strong>,
        }}
        isAnimating={isAnimating}
        skipHtml
        urlTransform={transformAnswerUrl}
      >
        {prepareEvidenceLinks(text, knownEvidenceIds, messageId)}
      </Streamdown>
    </div>
  );
}

function VerifiedClaims({ claims, messageId }: { claims: VerifiedClaim[]; messageId: string }) {
  if (claims.length === 0) {
    return null;
  }

  const statusLabels: Record<VerifiedClaim["status"], string> = {
    confirmed: "已核验",
    non_compliant: "不合规",
    prohibited: "禁止",
    insufficient_evidence: "待现场核实",
  };

  return (
    <section aria-label="核验结论" className="verified-claims">
      <h2>核验结论</h2>
      <ol>
        {claims.map((claim) => (
          <li className={`claim-${claim.status}`} key={claim.id}>
            <span className="claim-status">{statusLabels[claim.status]}</span>
            <span>{claim.statement}</span>
            <span className="claim-evidence">
              {claim.evidenceIds.map((evidenceId) => (
                <a href={`#${getEvidenceAnchorId(messageId, evidenceId)}`} key={evidenceId}>
                  [{evidenceId}]
                </a>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EvidenceSources({
  data,
  messageId,
  invalidEvidenceIds,
}: {
  data: EvidencePartData;
  messageId: string;
  invalidEvidenceIds: string[];
}) {
  const { evidence } = data;
  const groups = [
    { title: "数据库记录", items: evidence.filter((item) => item.kind === "database") },
    { title: "故障处理手册", items: evidence.filter((item) => item.source === "故障处理手册.md") },
    { title: "安全管理规程", items: evidence.filter((item) => item.source === "海上风电机组检修作业与安全管理规程.md") },
    { title: "派生规则", items: evidence.filter((item) => item.kind === "derived") },
  ].filter((group) => group.items.length > 0);

  return (
    <details className="sources-panel">
      <summary>依据来源（{evidence.length}）</summary>
      <Card className="source-card" size="sm">
        <CardContent className="sources-content">
          <ScrollArea className="source-scroll-area">
            <div className="source-scroll-content">
              {invalidEvidenceIds.length > 0 && (
                <p className="citation-warning">正文含未验证引用：{invalidEvidenceIds.map((id) => `[${id}]`).join("、")}</p>
              )}
              {groups.map((group) => (
                <section key={group.title} className="source-group">
                  <h3>{group.title}</h3>
                  {group.items.map((item) => (
                    <article id={getEvidenceAnchorId(messageId, item.id)} className="source-item" key={item.id}>
                      <span className="evidence-id">[{item.id}]</span>
                      <div>
                        <strong>{item.source}</strong>
                        <p>{item.location}</p>
                        <pre>{typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2)}</pre>
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </details>
  );
}

function ExecutionDisclosure({
  evidenceData,
  progressData,
  hasText,
}: {
  evidenceData?: EvidencePartData;
  progressData?: ExecutionProgressPartData;
  hasText: boolean;
}) {
  const [open, setOpen] = useState(() => !hasText);
  const hasAutoCollapsed = useRef(hasText);

  useEffect(() => {
    if (hasText && !hasAutoCollapsed.current) {
      setOpen(false);
      hasAutoCollapsed.current = true;
    }
  }, [hasText]);

  if (!evidenceData && !progressData) {
    return (
      <Card className="execution-panel" size="sm">
        <div className="execution-toggle">
          <span className="status-dot completed" />
          <span>已完成思考</span>
        </div>
      </Card>
    );
  }

  const steps = evidenceData?.executionSteps ?? progressData?.completedSteps ?? [];
  const label = getExecutionDisclosureLabel({ hasText, progressData });

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <Card className="execution-panel" size="sm">
        <CollapsibleTrigger className="execution-toggle">
          <span className={hasText ? "status-dot completed" : "status-dot thinking"} />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" className={open ? "toggle-icon is-open" : "toggle-icon is-closed"} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="execution-steps">
            {steps.map((step, index) => (
              <li key={`${step.label}-${index}`} className={step.status}>
                <span>{step.status === "done" ? "✓" : "!"}</span>
                {step.label}
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function RecommendedQuestions({
  answerId,
  currentQuestion,
  disabled,
  onSelect,
}: {
  answerId: string;
  currentQuestion?: string;
  disabled: boolean;
  onSelect: (question: string) => void;
}) {
  const recommendations = selectRecommendedQuestions(answerId, currentQuestion);

  return (
    <section className="recommended-questions" aria-label="推荐问题">
      {recommendations.map((question) => (
        <Button
          className="recommended-question"
          disabled={disabled}
          key={question}
          onClick={() => onSelect(question)}
          type="button"
          variant="secondary"
        >
          <span>{question}</span>
          <ArrowRight aria-hidden="true" />
        </Button>
      ))}
    </section>
  );
}

function AssistantMessage({
  message,
  currentQuestion,
  showRecommendations,
  isRunning,
  isLatestAssistantMessage,
  onAskRecommendation,
}: {
  message: WindPowerUIMessage;
  currentQuestion?: string;
  showRecommendations: boolean;
  isRunning: boolean;
  isLatestAssistantMessage: boolean;
  onAskRecommendation: (question: string) => void;
}) {
  const text = getText(message);
  const evidenceData = getEvidencePart(message);
  const progressData = getProgressPart(message);
  const scopeData = getScopePart(message);
  const knownEvidenceIds = evidenceData ? new Set(evidenceData.evidence.map((item) => item.id)) : undefined;
  const invalidEvidenceIds = evidenceData
    ? [...new Set([...evidenceData.invalidEvidenceIds, ...findUnknownEvidenceIds(text, evidenceData.evidence.map((item) => item.id))])]
    : [];
  const showEvidenceDetails = Boolean(evidenceData) && (!isLatestAssistantMessage || !isRunning);

  if (!text.trim() && !evidenceData && !progressData && !scopeData) {
    return null;
  }

  return (
    <article className="message assistant-message">
      {!scopeData && <ExecutionDisclosure evidenceData={evidenceData} progressData={progressData} hasText={text.trim().length > 0} />}
      {showEvidenceDetails && <VerifiedClaims claims={evidenceData!.claims} messageId={message.id} />}
      {text && (
        <MarkdownAnswer
          isAnimating={isRunning && isLatestAssistantMessage}
          knownEvidenceIds={knownEvidenceIds}
          messageId={message.id}
          text={text}
        />
      )}
      {showEvidenceDetails && <EvidenceSources data={evidenceData!} invalidEvidenceIds={invalidEvidenceIds} messageId={message.id} />}
      {showRecommendations && (
        <RecommendedQuestions
          answerId={message.id}
          currentQuestion={currentQuestion}
          disabled={isRunning}
          onSelect={onAskRecommendation}
        />
      )}
    </article>
  );
}

export function WindPowerChat() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { messages, sendMessage, setMessages, status, error, stop, clearError } = useChat<WindPowerUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    dataPartSchemas: { evidence: evidencePartDataSchema, progress: executionProgressPartDataSchema, scope: scopePartDataSchema },
  });
  const isRunning = status === "submitted" || status === "streaming";
  const latestMessage = messages.at(-1);
  const hasVisibleAssistantContent =
    latestMessage?.role === "assistant" &&
    (getText(latestMessage).trim().length > 0 ||
      Boolean(getEvidencePart(latestMessage)) ||
      Boolean(getProgressPart(latestMessage)) ||
      Boolean(getScopePart(latestMessage)));
  const requestExecutionState = getRequestExecutionState({
    isRunning,
    lastMessageRole: latestMessage?.role,
    hasVisibleAssistantContent,
    hasError: Boolean(error),
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${getComposerTextareaHeight(textarea.scrollHeight)}px`;
  }, [input]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || isRunning || question.length > 1000) {
      return;
    }
    clearError();
    setInput("");
    await sendMessage({ text: question });
  };

  const askExample = async (question: string) => {
    if (isRunning) {
      return;
    }
    clearError();
    await sendMessage({ text: question });
  };

  const handleComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSubmitComposerOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
    })) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <main className="chat-shell">
      {/* <header className="topbar">
        <div>
          <h1>海上风电维检 Agent</h1>
        </div>
        {messages.length > 0 && (
          <Button
            className="clear-button"
            onClick={() => {
              clearError();
              setMessages([]);
            }}
            type="button"
            variant="outline"
            size="sm"
            disabled={isRunning}
          >
            清空会话
          </Button>
        )}
      </header> */}

      <section className="conversation" aria-live="polite">
        {messages.length === 0 && (
          <div className="welcome">
            <p className="eyebrow">基于随题 SQLite 与 Markdown 资料</p>
            <h2>查询风机状态、告警、工单与作业规程</h2>
            <p>每次回答均展示实际使用的数据表、文档章节或规则依据；缺少现场证据时会明确说明。</p>
            <div className="example-grid">
              {exampleQuestions.map((question) => (
                <Button key={question} onClick={() => void askExample(question)} type="button" variant="outline" disabled={isRunning}>
                  {question}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          if (message.role === "user") {
            return (
              <article className="message user-message" key={message.id}>
                {getText(message)}
              </article>
            );
          }

          if (message.role !== "assistant") {
            return null;
          }

          const previousMessage = messages[index - 1];
          const currentQuestion = previousMessage?.role === "user" ? getText(previousMessage) : undefined;
          const isLatestAssistantMessage = message.id === latestMessage?.id;

          return (
            <AssistantMessage
              currentQuestion={currentQuestion}
              isLatestAssistantMessage={isLatestAssistantMessage}
              isRunning={isRunning}
              key={message.id}
              message={message}
              onAskRecommendation={(question) => void askExample(question)}
              showRecommendations={Boolean(getEvidencePart(message) || getScopePart(message)) && (!isLatestAssistantMessage || !isRunning)}
            />
          );
        })}

        {requestExecutionState === "thinking" && (
          <section className="execution-panel pending-thinking">
            <div className="execution-toggle">
              <span className="status-dot thinking" />
              <span>思考中</span>
            </div>
          </section>
        )}

        {requestExecutionState === "failed" && (
          <section className="execution-panel failed-thinking">
            <div className="execution-toggle">
              <span className="status-dot failed" />
              <span>思考失败</span>
            </div>
          </section>
        )}

        {error && <p className="error-banner">本次请求失败：{error.message}</p>}
      </section>

      <footer className="composer-wrap">
        <form className="composer" onSubmit={(event) => void submit(event)}>
          <Textarea
            aria-label="输入维检问题"
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="例如：查询 T06 最新状态，或分析 T03 的 24002 重复故障"
            rows={1}
            maxLength={1000}
            disabled={isRunning}
          />
          <Button
            aria-label={isRunning ? "停止生成" : "发送问题"}
            className={isRunning ? "send-button is-loading" : "send-button"}
            disabled={!isRunning && !input.trim()}
            onClick={isRunning ? stop : undefined}
            size="icon"
            type={isRunning ? "button" : "submit"}
          >
            {isRunning ? (
              <span className="send-loading-stop" aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
          </Button>
        </form>
        <p>只读检索 · 数据库与文档不写入 · 本地演示版</p>
      </footer>
    </main>
  );
}
