import {z} from "zod";
import {PiSimpleRequestOptionsSchema} from "nbook/shared/dto/pi-request-options.dto";

const ProviderIdSchema = z.string().trim().min(1, "providerId 不能为空").regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "providerId 格式不合法");
const ModelIdSchema = z.string().trim().min(1, "modelId 不能为空");
const NullableTextSchema = z.string().trim().nullable().optional().transform((value) => {
    const normalized = value?.trim() ?? "";
    return normalized ? normalized : null;
});
const ProviderOptionTextSchema = z.string().trim().default("");
const ProviderTimeoutMsSchema = z.number().int("timeoutMs 必须是整数").positive("timeoutMs 必须大于 0").nullable().default(null);
const DefaultModelKeySchema = z.string().trim().min(1, "默认模型不能为空").nullable().default(null);
const AgentProfileKeySchema = z.string().trim().min(1, "profileKey 不能为空");
const TemperatureSchema = z.number().nonnegative("temperature 不能小于 0").nullable().default(null);
const TopKSchema = z.number().int("topK 必须是整数").positive("topK 必须大于 0").nullable().default(null);
const ContextWindowTokensSchema = z.number().int("contextWindowTokens 必须是整数").positive("contextWindowTokens 必须大于 0").nullable().default(null);
export const ThinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const ReasoningEffortSchema = ThinkingLevelSchema.nullable().default(null);
const ModelInputKindSchema = z.enum(["text", "image"]);
const PiModelApiSchema = z.string().trim().min(1, "api 不能为空").nullable().default(null);
export const SupportedPiApiSchema = z.enum([
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "bedrock-converse-stream",
]);
const PiModelInputSchema = z.array(ModelInputKindSchema).min(1, "input 至少需要声明一种输入类型").nullable().default(null);
const PiModelReasoningSchema = z.boolean().nullable().default(null);
const PiModelMaxTokensSchema = z.number().int("maxTokens 必须是整数").positive("maxTokens 必须大于 0").nullable().default(null);
const PiPriceSchema = z.number().finite("价格必须是有限数字").nonnegative("价格不能小于 0");
const PiModelCostTierSchema = z.object({
    inputTokensAbove: z.number().int("tier threshold 必须是整数").nonnegative("tier threshold 不能小于 0"),
    input: PiPriceSchema,
    output: PiPriceSchema,
    cacheRead: PiPriceSchema,
    cacheWrite: PiPriceSchema,
});
const PiModelCostObjectSchema = z.object({
    input: PiPriceSchema,
    output: PiPriceSchema,
    cacheRead: PiPriceSchema,
    cacheWrite: PiPriceSchema,
    tiers: z.array(PiModelCostTierSchema).default([]),
}).superRefine((cost, ctx) => {
    const thresholds = new Set<number>();
    for (const [index, tier] of cost.tiers.entries()) {
        if (thresholds.has(tier.inputTokensAbove)) {
            ctx.addIssue({
                code: "custom",
                path: ["tiers", index, "inputTokensAbove"],
                message: `tier threshold 重复：${tier.inputTokensAbove}`,
            });
        }
        thresholds.add(tier.inputTokensAbove);
    }
});
const PiModelCostSchema = PiModelCostObjectSchema.nullable().default(null);
const PiModelCompatSchema = z.record(z.string(), z.json()).nullable().default(null);
const PiModelHeadersSchema = z.record(z.string(), z.string().nullable()).nullable().default(null);
const PiThinkingLevelMapSchema = z.record(z.string(), z.string().nullable()).nullable().default(null);
export const ProviderDiscoveryAdapterSchema = z.enum(["openai-models", "openrouter-models", "google-models", "none"]);
export const ProviderDiscoveryConfigSchema = z.object({
    adapter: ProviderDiscoveryAdapterSchema.default("none"),
    endpointPath: NullableTextSchema,
});

/**
 * Provider 连接配置。
 */
export const ModelProviderOptionsDtoSchema = z.object({
    apiKey: ProviderOptionTextSchema,
    baseURL: ProviderOptionTextSchema,
    proxy: ProviderOptionTextSchema,
    timeoutMs: ProviderTimeoutMsSchema,
    requestOptions: PiSimpleRequestOptionsSchema,
});

/**
 * 单个已配置模型。
 */
export const ConfiguredModelDtoSchema = z.object({
    name: z.string().trim().min(1, "模型名称不能为空"),
    id: ModelIdSchema,
    group: NullableTextSchema,
    enabled: z.boolean().default(true),
    api: PiModelApiSchema,
    reasoning: PiModelReasoningSchema,
    input: PiModelInputSchema,
    maxTokens: PiModelMaxTokensSchema,
    cost: PiModelCostSchema,
    compat: PiModelCompatSchema,
    headers: PiModelHeadersSchema,
    thinkingLevelMap: PiThinkingLevelMapSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/**
 * 单个已配置 Provider。
 */
export const ConfiguredProviderDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1, "Provider 名称不能为空"),
    enabled: z.boolean().default(true),
    /** Provider 创建、发现和新模型草稿使用的默认 Pi API；runtime 仍要求启用模型保存完整 api。 */
    api: PiModelApiSchema,
    discovery: ProviderDiscoveryConfigSchema,
    options: ModelProviderOptionsDtoSchema,
    models: z.array(ConfiguredModelDtoSchema).default([]),
});

/**
 * 启用模型选项。
 */
export const EnabledModelOptionDtoSchema = z.object({
    key: z.string().trim().min(1, "模型 key 不能为空"),
    label: z.string().trim().min(1, "模型标签不能为空"),
    providerId: ProviderIdSchema,
    modelId: ModelIdSchema,
    contextWindowTokens: ContextWindowTokensSchema,
});

/**
 * Agent Profile 模型配置。
 */
export const AgentProfileModelConfigDtoSchema = z.object({
    modelKey: DefaultModelKeySchema,
    temperature: TemperatureSchema,
    topK: TopKSchema,
    reasoningEffort: ReasoningEffortSchema,
    stream: z.boolean().default(true),
});

/**
 * 单个 Agent Profile 设定。
 */
export const ConfiguredAgentProfileDtoSchema = z.object({
    profileKey: AgentProfileKeySchema,
    name: z.string().trim().min(1, "Profile 名称不能为空"),
    model: AgentProfileModelConfigDtoSchema,
});

/**
 * 模型设定响应。
 */
export const ModelSettingsDtoSchema = z.object({
    defaultModelKey: DefaultModelKeySchema,
    /**
     * 为空表示当前没有可用默认模型。
     */
    defaultModelLabel: z.string().trim().nullable().default(null),
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    providers: z.array(ConfiguredProviderDtoSchema).default([]),
});

/**
 * 更新模型设定请求。
 */
export const UpdateModelSettingsRequestDtoSchema = z.object({
    defaultModelKey: DefaultModelKeySchema,
    providers: z.array(ConfiguredProviderDtoSchema).default([]),
}).superRefine((value, ctx) => {
    const providerIdSet = new Set<string>();
    const enabledModelKeys = new Set<string>();

    for (const provider of value.providers) {
        if (provider.api && !SupportedPiApiSchema.safeParse(provider.api).success) {
            ctx.addIssue({
                code: "custom",
                path: ["providers", provider.id, "api"],
                message: `不支持的 Pi API：${provider.api}`,
            });
        }
        if (providerIdSet.has(provider.id)) {
            ctx.addIssue({
                code: "custom",
                path: ["providers"],
                message: `provider ${provider.id} 重复`,
            });
            return;
        }
        providerIdSet.add(provider.id);

        const modelIdSet = new Set<string>();
        for (const model of provider.models) {
            if (model.api && !SupportedPiApiSchema.safeParse(model.api).success) {
                ctx.addIssue({
                    code: "custom",
                    path: ["providers", provider.id, "models", model.id, "api"],
                    message: `不支持的 Pi API：${model.api}`,
                });
            }
            if (modelIdSet.has(model.id)) {
                ctx.addIssue({
                    code: "custom",
                    path: ["providers"],
                    message: `provider ${provider.id} 下存在重复模型 ${model.id}`,
                });
                return;
            }
            modelIdSet.add(model.id);

            if (provider.enabled && model.enabled) {
                if (!provider.options.baseURL && model.api !== "bedrock-converse-stream") {
                    ctx.addIssue({
                        code: "custom",
                        path: ["providers", provider.id, "options", "baseURL"],
                        message: `启用模型 ${provider.id}/${model.id} 前必须设置 Provider Base URL`,
                    });
                }
                if (!model.api) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "api"], message: "启用模型必须设置 Pi API"});
                }
                if (model.reasoning === null) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "reasoning"], message: "启用模型必须明确 reasoning 能力"});
                }
                if (!model.input?.length) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "input"], message: "启用模型必须声明输入能力"});
                }
                if (model.contextWindowTokens === null) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "contextWindowTokens"], message: "启用模型必须设置 contextWindowTokens"});
                }
                if (model.maxTokens === null) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "maxTokens"], message: "启用模型必须设置 maxTokens"});
                }
                if (model.contextWindowTokens !== null && model.maxTokens !== null && model.maxTokens > model.contextWindowTokens) {
                    ctx.addIssue({code: "custom", path: ["providers", provider.id, "models", model.id, "maxTokens"], message: "maxTokens 不能大于 contextWindowTokens"});
                }
                enabledModelKeys.add(`${provider.id}/${model.id}`);
            }
        }
    }

    if (enabledModelKeys.size === 0) {
        if (value.defaultModelKey !== null) {
            ctx.addIssue({
                code: "custom",
                path: ["defaultModelKey"],
                message: "当前没有启用模型时，默认模型必须为空",
            });
        }
        return;
    }

    if (value.defaultModelKey === null) {
        ctx.addIssue({
            code: "custom",
            path: ["defaultModelKey"],
            message: "存在启用模型时，必须指定默认模型",
        });
        return;
    }

    if (!enabledModelKeys.has(value.defaultModelKey)) {
        ctx.addIssue({
            code: "custom",
            path: ["defaultModelKey"],
            message: "默认模型必须指向一个已启用模型",
        });
    }
});

/**
 * Agent Profile 模型设定响应。
 */
export const AgentProfileModelSettingsDtoSchema = z.object({
    enabledModels: z.array(EnabledModelOptionDtoSchema).default([]),
    profileModelDefaults: AgentProfileModelConfigDtoSchema,
    agentProfiles: z.array(ConfiguredAgentProfileDtoSchema).default([]),
});

/**
 * 更新 Agent Profile 模型设定请求。
 */
export const UpdateAgentProfileModelSettingsRequestDtoSchema = z.object({
    profileModelDefaults: AgentProfileModelConfigDtoSchema,
    agentProfiles: z.array(ConfiguredAgentProfileDtoSchema).default([]),
}).superRefine((value, ctx) => {
    const profileKeySet = new Set<string>();

    for (const profile of value.agentProfiles) {
        if (profileKeySet.has(profile.profileKey)) {
            ctx.addIssue({
                code: "custom",
                path: ["agentProfiles"],
                message: `profile ${profile.profileKey} 重复`,
            });
            return;
        }
        profileKeySet.add(profile.profileKey);
    }
});

/**
 * Provider 草稿，请求连通性测试与远程模型发现时使用。
 */
export const ModelProviderDraftDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1, "Provider 名称不能为空"),
    api: PiModelApiSchema,
    discovery: ProviderDiscoveryConfigSchema,
    options: ModelProviderOptionsDtoSchema,
});

/**
 * 远程发现到的 Provider 模型。
 */
export const DiscoveredProviderModelDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1, "模型名称不能为空"),
    group: NullableTextSchema,
    api: PiModelApiSchema,
    reasoning: PiModelReasoningSchema,
    input: PiModelInputSchema,
    contextWindowTokens: ContextWindowTokensSchema,
    maxTokens: PiModelMaxTokensSchema,
    cost: PiModelCostSchema,
    compat: PiModelCompatSchema,
    headers: PiModelHeadersSchema,
    thinkingLevelMap: PiThinkingLevelMapSchema,
});

/**
 * Provider 连通性测试请求。
 */
export const CheckProviderRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    models: z.array(ConfiguredModelDtoSchema.omit({
        enabled: true,
    })).default([]),
    useSavedApiKey: z.boolean().default(true),
    useSavedModels: z.boolean().default(true),
});

/**
 * Provider 连通性测试响应。
 */
export const CheckProviderResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/**
 * Provider 远程模型发现请求。
 */
export const DiscoverProviderModelsRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
});

/**
 * Provider 远程模型发现响应。
 */
export const DiscoverProviderModelsResponseDtoSchema = z.object({
    models: z.array(DiscoveredProviderModelDtoSchema).default([]),
    message: z.string().trim().min(1),
});

/**
 * 单模型健康检查请求。
 */
export const CheckModelRequestDtoSchema = z.object({
    provider: ModelProviderDraftDtoSchema,
    model: ConfiguredModelDtoSchema.omit({
        enabled: true,
    }),
    useSavedApiKey: z.boolean().default(true),
});

/**
 * 单模型健康检查响应。
 */
export const CheckModelResponseDtoSchema = z.object({
    success: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    message: z.string().trim().min(1),
});

/** NeuroBook 维护的唯一标准模型条目。 */
export const ModelCatalogEntryDtoSchema = z.object({
    id: ModelIdSchema,
    name: z.string().trim().min(1),
    canonicalSource: ProviderIdSchema,
    defaultApi: SupportedPiApiSchema,
    reasoning: z.boolean(),
    thinkingLevelMap: PiThinkingLevelMapSchema,
    input: z.array(ModelInputKindSchema).min(1),
    cost: PiModelCostObjectSchema.nullable(),
    contextWindowTokens: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    compatByApi: z.record(z.string(), PiModelCompatSchema),
    headersByApi: z.record(z.string(), PiModelHeadersSchema),
});

/** NeuroBook Provider 创建预设；复制后与用户配置无持续关联。 */
export const ProviderPresetDtoSchema = z.object({
    id: ProviderIdSchema,
    name: z.string().trim().min(1),
    baseUrl: z.string().trim(),
    supportedApis: z.array(SupportedPiApiSchema).min(1),
    defaultApi: SupportedPiApiSchema.nullable(),
    discovery: ProviderDiscoveryConfigSchema,
});

/** 设置页一次加载的 NeuroBook Provider Preset 与 Model Catalog。 */
export const NeuroModelCatalogDtoSchema = z.object({
    providerPresets: z.array(ProviderPresetDtoSchema).default([]),
    models: z.array(ModelCatalogEntryDtoSchema).default([]),
});

export type ModelInputKind = z.infer<typeof ModelInputKindSchema>;
export type ThinkingLevelDto = z.infer<typeof ThinkingLevelSchema>;
export type ModelProviderOptionsDto = z.infer<typeof ModelProviderOptionsDtoSchema>;
export type ConfiguredModelDto = z.infer<typeof ConfiguredModelDtoSchema>;
export type ConfiguredProviderDto = z.infer<typeof ConfiguredProviderDtoSchema>;
export type EnabledModelOptionDto = z.infer<typeof EnabledModelOptionDtoSchema>;
export type AgentProfileModelConfigDto = z.infer<typeof AgentProfileModelConfigDtoSchema>;
export type ConfiguredAgentProfileDto = z.infer<typeof ConfiguredAgentProfileDtoSchema>;
export type ModelSettingsDto = z.infer<typeof ModelSettingsDtoSchema>;
export type UpdateModelSettingsRequestDto = z.infer<typeof UpdateModelSettingsRequestDtoSchema>;
export type AgentProfileModelSettingsDto = z.infer<typeof AgentProfileModelSettingsDtoSchema>;
export type UpdateAgentProfileModelSettingsRequestDto = z.infer<typeof UpdateAgentProfileModelSettingsRequestDtoSchema>;
export type ModelProviderDraftDto = z.infer<typeof ModelProviderDraftDtoSchema>;
export type DiscoveredProviderModelDto = z.infer<typeof DiscoveredProviderModelDtoSchema>;
export type CheckProviderRequestDto = z.infer<typeof CheckProviderRequestDtoSchema>;
export type CheckProviderResponseDto = z.infer<typeof CheckProviderResponseDtoSchema>;
export type DiscoverProviderModelsRequestDto = z.infer<typeof DiscoverProviderModelsRequestDtoSchema>;
export type DiscoverProviderModelsResponseDto = z.infer<typeof DiscoverProviderModelsResponseDtoSchema>;
export type CheckModelRequestDto = z.infer<typeof CheckModelRequestDtoSchema>;
export type CheckModelResponseDto = z.infer<typeof CheckModelResponseDtoSchema>;
export type ProviderDiscoveryAdapterDto = z.infer<typeof ProviderDiscoveryAdapterSchema>;
export type ModelCatalogEntryDto = z.infer<typeof ModelCatalogEntryDtoSchema>;
export type ProviderPresetDto = z.infer<typeof ProviderPresetDtoSchema>;
export type NeuroModelCatalogDto = z.infer<typeof NeuroModelCatalogDtoSchema>;
