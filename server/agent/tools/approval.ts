import type {Message} from "nbook/server/agent/messages/types";
import {createTextToolResult} from "nbook/server/agent/messages/message-utils";
import type {AgentResolution} from "nbook/server/agent/tools/types";

/**
 * 查找 session 尾部未完成的审批 tool calls。
 * 返回数组，按调用顺序排列（先出现的在前）。
 */
export function findPendingApprovalCalls(messages: Message[], approvalToolKeys: readonly string[]): Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}> {
    const completed = new Set(messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId));

    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (!message || message.role !== "assistant") {
            continue;
        }
        const pendingCalls = message.content.filter((block) => {
            return block.type === "toolCall" && approvalToolKeys.includes(block.name) && !completed.has(block.id);
        });

        if (pendingCalls.length > 0) {
            return pendingCalls
                .filter((block): block is Extract<typeof block, {type: "toolCall"}> => block.type === "toolCall")
                .map((toolCall) => ({
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    args: toolCall.arguments,
                }));
        }
    }
    return [];
}

/**
 * 向后兼容：查找单个 pending approval call。
 */
export function findPendingApprovalCall(messages: Message[], approvalToolKeys: readonly string[]): {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
} | null {
    const calls = findPendingApprovalCalls(messages, approvalToolKeys);
    return calls[0] ?? null;
}

/**
 * 把 continue resolution 转成标准 tool result message。
 */
export function resolutionToToolResult(resolution: AgentResolution, pending: {toolCallId: string; toolName: string}): Message {
    if (resolution.toolCallId !== pending.toolCallId) {
        throw new Error(`resolution toolCallId ${resolution.toolCallId} 与 pending toolCallId ${pending.toolCallId} 不匹配`);
    }

    if (resolution.kind === "user_input") {
        return createTextToolResult({
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            text: resolution.answers
                .sort((left, right) => left.questionIndex - right.questionIndex)
                .map((answer) => `${answer.questionIndex + 1}. ${answer.text}`)
                .join("\n"),
            details: resolution,
        });
    }

    return createTextToolResult({
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        text: resolution.approved
            ? resolution.resultText ?? "Approved."
            : resolution.resultText ?? "Rejected.",
        isError: !resolution.approved,
        details: resolution,
    });
}
