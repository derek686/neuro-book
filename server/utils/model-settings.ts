import type {
    AgentProfileModelConfigDto,
    AgentProfileModelSettingsDto,
    CheckModelResponseDto,
    CheckProviderResponseDto,
    ConfiguredAgentProfileDto,
    ConfiguredModelDto,
    DiscoverProviderModelsResponseDto,
    EnabledModelOptionDto,
    ModelProviderDraftDto,
    ModelSettingsDto,
    UpdateAgentProfileModelSettingsRequestDto,
    UpdateModelSettingsRequestDto,
} from "nbook/shared/dto/app-settings.dto";
import {ThinkingLevelSchema} from "nbook/shared/dto/app-settings.dto";
import type {Api, Model, Models} from "@earendil-works/pi-ai";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {
    AgentProfileConfig,
    AgentProfileModelConfig,
    ConfiguredModelConfig,
    ConfiguredProviderConfig,
    ModelProviderOptionsConfig,
    ModelSettingsConfig,
} from "nbook/server/config/types";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {mergePiRequestHeaders, parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {tracedStreamSimple} from "nbook/server/agent/observability/traced-provider";
import {providerErrorText, sanitizeProviderErrorMessage} from "nbook/server/agent/observability/provider-error-sanitizer";
import {resolvePiModelMetadata} from "nbook/server/agent/harness/pi-model-metadata";
import {discoverProviderModelMetadata} from "nbook/server/models/discovery";

type ResolvedDefaultModel = {
    providerId: string;
    provider: ConfiguredProviderConfig;
    model: ConfiguredModelConfig;
};

type ResolvedContextWindow = {
    tokens: number | null;
    source: "manual" | "unknown";
};
type ModelHealthCheckOptions = {
    signal?: AbortSignal;
    /** 可注入与生产一致的 Pi runtime resolver；调用方通常使用默认实现。 */
    runtimeResolver?: (providerDraft: ModelProviderDraftDto, modelDraft: Omit<ConfiguredModelDto, "enabled">, model: Model<Api>) => Models;
};

export type AgentProfileSettingDefinition = {
    profileKey: string;
    name: string;
};

const DEFAULT_MODEL_SMOKE_TIMEOUT_MS = 30_000;
export const MODEL_SMOKE_CHECK_PROMPTS = [
    "随便想一个问题，然后用一句话自己回答。",
    "用一句话解释一个常见自然现象。",
    "给出一个两步以内的小计划。",
    "用一句话总结今天适合做的一件小事。",
    "提出一个简单判断题，并直接给出答案。",
] as const;

/**
 * 生成 `providerId/modelId` 形式的模型 key。
 */
export function buildModelKey(providerId: string, modelId: string): string {
    return `${providerId}/${modelId}`;
}

/**
 * 从模型 ID 推导默认分组。
 */
export function deriveModelGroup(modelId: string): string {
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) {
        return "default";
    }

    const separatorIndex = trimmedModelId.indexOf("-");
    return separatorIndex <= 0 ? trimmedModelId : trimmedModelId.slice(0, separatorIndex);
}

/**
 * 构造模型展示名。
 */
export function buildModelLabel(providerName: string, modelName: string): string {
    return `${providerName} / ${modelName}`;
}

/**
 * 解析模型上下文窗口。当前只信任 Global Config 中的手动配置。
 */
export function resolveModelContextWindow(model: Pick<ConfiguredModelConfig, "contextWindowTokens">): ResolvedContextWindow {
    if (typeof model.contextWindowTokens === "number" && Number.isFinite(model.contextWindowTokens)) {
        return {
            tokens: Math.trunc(model.contextWindowTokens),
            source: "manual",
        };
    }

    return {
        tokens: null,
        source: "unknown",
    };
}

/**
 * 把 DTO 请求体转成运行时配置结构。
 */
export function convertModelSettingsRequestToConfig(request: UpdateModelSettingsRequestDto): ModelSettingsConfig {
    const config: ModelSettingsConfig = {
        defaultModelKey: request.defaultModelKey,
        providers: Object.fromEntries(
            request.providers.map((provider) => [provider.id, {
                name: provider.name,
                enabled: provider.enabled,
                api: provider.api,
                discovery: provider.discovery,
                options: {
                    apiKey: provider.options.apiKey.trim(),
                    baseURL: provider.options.baseURL.trim(),
                    proxy: provider.options.proxy.trim(),
                    timeoutMs: provider.options.timeoutMs,
                    requestOptions: provider.options.requestOptions,
                },
                models: Object.fromEntries(
                    provider.models.map((model) => [model.id, {
                        name: model.name.trim(),
                        id: model.id.trim(),
                        group: model.group?.trim() ? model.group.trim() : null,
                        enabled: model.enabled,
                        api: model.api,
                        reasoning: model.reasoning,
                        input: model.input,
                        maxTokens: model.maxTokens,
                        cost: model.cost
                            ? {
                                ...model.cost,
                                tiers: [...model.cost.tiers].sort((left, right) => left.inputTokensAbove - right.inputTokensAbove),
                            }
                            : null,
                        compat: model.compat,
                        headers: model.headers,
                        thinkingLevelMap: model.thinkingLevelMap,
                        contextWindowTokens: model.contextWindowTokens,
                    }]),
                ),
            }]),
        ),
    };
    for (const [providerId, provider] of Object.entries(config.providers)) {
        if (!provider.enabled) {
            continue;
        }
        for (const model of Object.values(provider.models)) {
            if (model.enabled) {
                resolvePiModelMetadata(providerId, provider, model);
            }
        }
    }
    return config;
}

/**
 * 把 Agent Profile DTO 请求体转成运行时配置结构。
 */
export function convertAgentProfileModelSettingsRequestToConfig(
    request: UpdateAgentProfileModelSettingsRequestDto,
): {profileModelDefaults: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>} {
    return {
        profileModelDefaults: normalizeAgentProfileModelConfig(request.profileModelDefaults),
        profiles: Object.fromEntries(
            request.agentProfiles.map((profile) => [profile.profileKey, {
                model: normalizeAgentProfileModelConfig(profile.model),
                settings: {},
                runtime: {},
            }]),
        ),
    };
}

/**
 * 把运行时配置转成 API DTO。
 */
export function buildModelSettingsDto(appConfig: {models: ModelSettingsConfig}): ModelSettingsDto {
    const config = appConfig.models;
    const providers = Object.entries(config.providers).map(([providerId, provider]) => ({
        id: providerId,
        name: provider.name,
        enabled: provider.enabled,
        api: provider.api,
        discovery: provider.discovery,
        options: {
            apiKey: provider.options.apiKey,
            baseURL: provider.options.baseURL,
            proxy: provider.options.proxy,
            timeoutMs: provider.options.timeoutMs,
            requestOptions: provider.options.requestOptions,
        },
        models: Object.values(provider.models).map((model) => ({
            name: model.name,
            id: model.id,
            group: model.group,
            enabled: model.enabled,
            api: model.api,
            reasoning: model.reasoning,
            input: model.input,
            maxTokens: model.maxTokens,
            cost: model.cost,
            compat: model.compat,
            headers: model.headers,
            thinkingLevelMap: model.thinkingLevelMap,
            contextWindowTokens: model.contextWindowTokens,
        })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const defaultModel = resolveDefaultModel(config);

    return {
        defaultModelKey: config.defaultModelKey,
        defaultModelLabel: defaultModel ? buildModelLabel(defaultModel.provider.name, defaultModel.model.name) : null,
        enabledModels: listEnabledModels(config),
        providers,
    };
}

/**
 * 把 Agent Profile 配置转成 API DTO。
 */
export function buildAgentProfileModelSettingsDto(
    appConfig: {agent: {profileModelDefaults: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>}; models: ModelSettingsConfig},
    profileDefinitions: AgentProfileSettingDefinition[],
): AgentProfileModelSettingsDto {
    return {
        enabledModels: listEnabledModels(appConfig.models),
        profileModelDefaults: normalizeAgentProfileModelConfig(appConfig.agent.profileModelDefaults),
        agentProfiles: profileDefinitions.map((definition): ConfiguredAgentProfileDto => ({
            profileKey: definition.profileKey,
            name: definition.name,
            model: resolveAgentProfileModelConfig(appConfig, definition.profileKey),
        })),
    };
}

/**
 * 列出所有启用模型，供前端默认模型选择器使用。
 */
export function listEnabledModels(config: ModelSettingsConfig): EnabledModelOptionDto[] {
    const enabledModels: EnabledModelOptionDto[] = [];

    for (const [providerId, provider] of Object.entries(config.providers)) {
        if (!provider.enabled) {
            continue;
        }
        for (const model of Object.values(provider.models)) {
            if (!model.enabled) {
                continue;
            }

            enabledModels.push({
                key: buildModelKey(providerId, model.id),
                label: buildModelLabel(provider.name, model.name),
                providerId,
                modelId: model.id,
                contextWindowTokens: resolveModelContextWindow(model).tokens,
            });
        }
    }

    return enabledModels.sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * 解析指定模型 key。
 */
export function resolveConfiguredModel(config: ModelSettingsConfig, modelKey: string | null | undefined): ResolvedDefaultModel | null {
    const normalizedModelKey = modelKey?.trim() ?? "";
    if (!normalizedModelKey) {
        return null;
    }

    const separatorIndex = normalizedModelKey.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === normalizedModelKey.length - 1) {
        return null;
    }

    const providerId = normalizedModelKey.slice(0, separatorIndex);
    const modelId = normalizedModelKey.slice(separatorIndex + 1);
    const provider = config.providers[providerId];
    const model = provider?.models[modelId];
    if (!provider || !provider.enabled || !model || !model.enabled) {
        return null;
    }

    return {
        providerId,
        provider,
        model,
    };
}

/**
 * 解析默认模型指向的 provider / model。
 */
export function resolveDefaultModel(config: ModelSettingsConfig): ResolvedDefaultModel | null {
    return resolveConfiguredModel(config, config.defaultModelKey);
}

/**
 * 解析单个 profile 的模型配置。
 */
export function resolveAgentProfileModelConfig(appConfig: {agent: {profileModelDefaults?: AgentProfileModelConfig; profiles: Record<string, AgentProfileConfig>}}, profileKey: string): AgentProfileModelConfig {
    return normalizeAgentProfileModelConfig({
        ...(appConfig.agent.profileModelDefaults ?? {}),
        ...(appConfig.agent.profiles[profileKey]?.model ?? {}),
    });
}

/**
 * 对 Provider 进行 Pi smoke 连通性测试。
 */
export async function checkProviderConnection(
    providerDraft: ModelProviderDraftDto,
    modelDrafts?: Array<Omit<ConfiguredModelDto, "enabled">>,
    options: ModelHealthCheckOptions = {},
): Promise<CheckProviderResponseDto> {
    const modelDraft = modelDrafts?.[0] ?? null;
    if (!modelDraft) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 没有可检查的模型；请先启用或添加一个模型。`,
        };
    }

    return runPiModelSmokeCheck(providerDraft, modelDraft, "provider", options);
}

/**
 * 从 OpenAI-compatible `/models` 端点抓取 Provider 模型列表。
 */
export async function discoverProviderModels(providerDraft: ModelProviderDraftDto): Promise<DiscoverProviderModelsResponseDto> {
    const startedAt = Date.now();
    const models = await discoverProviderModelMetadata(providerDraft);

    return {
        models,
        message: `已从 ${providerDraft.name} 发现 ${models.length} 个模型，用时 ${String(Date.now() - startedAt)}ms。`,
    };
}

/**
 * 对单个模型执行 Pi smoke 健康检查。
 */
export async function checkModelHealth(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    return runPiModelSmokeCheck(providerDraft, modelDraft, "model", options);
}

/**
 * 从固定 smoke prompt 列表中随机抽取一个检查问题。
 */
export function pickModelSmokeCheckPrompt(random = Math.random): string {
    const index = Math.floor(random() * MODEL_SMOKE_CHECK_PROMPTS.length);
    return MODEL_SMOKE_CHECK_PROMPTS[Math.min(Math.max(index, 0), MODEL_SMOKE_CHECK_PROMPTS.length - 1)] ?? MODEL_SMOKE_CHECK_PROMPTS[0];
}

/**
 * 归一化 profile 模型配置。
 */
function normalizeAgentProfileModelConfig(config: Partial<AgentProfileModelConfigDto> | AgentProfileModelConfig | undefined): AgentProfileModelConfig {
    const reasoningEffort = ThinkingLevelSchema.nullable().safeParse(config?.reasoningEffort ?? null);
    return {
        modelKey: config?.modelKey?.trim() ? config.modelKey.trim() : null,
        temperature: typeof config?.temperature === "number" && Number.isFinite(config.temperature) ? config.temperature : null,
        topK: typeof config?.topK === "number" && Number.isFinite(config.topK) ? Math.trunc(config.topK) : null,
        reasoningEffort: reasoningEffort.success ? reasoningEffort.data : null,
        stream: config?.stream ?? true,
    };
}

/**
 * 规范化 provider options，保留类型引用，避免旧导出消费者漂移。
 */
export function normalizeModelProviderOptions(options: ModelProviderOptionsConfig): ModelProviderOptionsConfig {
    return {
        apiKey: options.apiKey.trim(),
        baseURL: options.baseURL.trim(),
        proxy: options.proxy.trim(),
        timeoutMs: options.timeoutMs,
        requestOptions: options.requestOptions,
    };
}

/**
 * 设置页不会回传已保存的 secret；检查类接口在后端补齐旧 key。
 */
export function withSavedProviderApiKey(providerDraft: ModelProviderDraftDto, savedApiKey: string | undefined): ModelProviderDraftDto {
    if (providerDraft.options.apiKey.trim() || !savedApiKey) {
        return providerDraft;
    }
    return {
        ...providerDraft,
        options: {
            ...providerDraft.options,
            apiKey: savedApiKey,
        },
    };
}

async function runPiModelSmokeCheck(
    providerDraft: ModelProviderDraftDto,
    modelDraft: Omit<ConfiguredModelDto, "enabled">,
    scope: "provider" | "model",
    options: ModelHealthCheckOptions = {},
): Promise<CheckModelResponseDto> {
    if (providerDraft.options.proxy.trim()) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name} 已配置代理，但 Pi 检查暂不支持通过 Provider 代理发起请求；请先使用 Agent smoke 或移除代理后再检查。`,
        };
    }

    if (options.signal?.aborted) {
        return {
            success: false,
            latencyMs: null,
            message: `${providerDraft.name}/${modelDraft.id} 检查已取消。`,
        };
    }

    const startedAt = Date.now();
    try {
        const model = resolvePiModelMetadata(providerDraft.id, {
            name: providerDraft.name,
            enabled: true,
            api: providerDraft.api,
            discovery: providerDraft.discovery,
            options: providerDraft.options,
            models: {},
        }, {...modelDraft, enabled: true});
        const config = {
            models: {
                defaultModelKey: `${providerDraft.id}/${modelDraft.id}`,
                providers: {
                    [providerDraft.id]: {
                        name: providerDraft.name,
                        enabled: true,
                        api: providerDraft.api,
                        discovery: providerDraft.discovery,
                        options: providerDraft.options,
                        models: {
                            [modelDraft.id]: {...modelDraft, enabled: true},
                        },
                    },
                },
            },
        };
        const models = options.runtimeResolver?.(providerDraft, modelDraft, model) ?? resolvePiModelsFromConfig(config, model);
        const requestOptions = parsePiSimpleRequestOptions(providerDraft.options.requestOptions);
        const apiKey = providerDraft.options.apiKey.trim() || undefined;
        const stream = tracedStreamSimple(models, model, {
            systemPrompt: "You are a concise connectivity smoke test assistant.",
            messages: [createUserMessage({text: pickModelSmokeCheckPrompt()})],
            tools: [],
        }, {
            ...requestOptions,
            ...piRequestAuthOptions({
                api: model.api,
                apiKey,
                env: requestOptions.env,
            }),
            headers: mergePiRequestHeaders(model.headers, requestOptions.headers),
            timeoutMs: providerDraft.options.timeoutMs ?? DEFAULT_MODEL_SMOKE_TIMEOUT_MS,
            maxTokens: Math.min(96, model.maxTokens),
            reasoning: undefined,
            cacheRetention: "none",
            signal: options.signal,
        });
        const response = await stream.result();
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || response.stopReason === "aborted") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查已取消。`,
            };
        }
        if (response.stopReason === "error") {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${model.id} 检查失败：${sanitizeProviderErrorMessage(response.errorMessage || "provider 未返回错误详情")}`,
            };
        }
        return {
            success: true,
            latencyMs,
            message: scope === "provider"
                ? `${providerDraft.name} Pi 检查通过：${model.id}，用时 ${String(latencyMs)}ms。`
                : `${providerDraft.name}/${model.id} Pi 检查通过，用时 ${String(latencyMs)}ms。`,
        };
    } catch (error) {
        const latencyMs = Date.now() - startedAt;
        if (options.signal?.aborted || isAbortError(error)) {
            return {
                success: false,
                latencyMs,
                message: `${providerDraft.name}/${modelDraft.id} 检查已取消。`,
            };
        }
        return {
            success: false,
            latencyMs,
            message: `${providerDraft.name}/${modelDraft.id} 检查失败：${providerErrorText(error)}`,
        };
    }
}

/**
 * 判断 Provider SDK 抛出的错误是否来自 AbortSignal。
 */
function isAbortError(error: unknown): boolean {
    if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
        return true;
    }
    const name = typeof error === "object" && error !== null && "name" in error
        ? (error as {name?: unknown}).name
        : null;
    return name === "AbortError";
}
