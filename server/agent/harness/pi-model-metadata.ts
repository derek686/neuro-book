import type {Api, Model} from "@earendil-works/pi-ai";
import type {ConfiguredModelConfig, ConfiguredProviderConfig} from "nbook/server/config/types";
import {resolvePiRuntimeCost} from "nbook/server/utils/pi-model-cost";
import {SupportedPiApiSchema} from "nbook/shared/dto/app-settings.dto";

export type ResolvedPiModel = Model<Api> & {
    /** Session selection 使用的本地 Provider Config ID。 */
    providerConfigId: string;
};

/**
 * 将完整、自包含的用户 Provider Config 解析为 Pi Model。
 * Runtime 不读取 Provider Preset、Model Catalog 或远程发现结果，也不猜测任何必需能力。
 */
export function resolvePiModelMetadata(
    providerConfigId: string,
    provider: ConfiguredProviderConfig,
    model: ConfiguredModelConfig,
): ResolvedPiModel {
    const apiResult = SupportedPiApiSchema.safeParse(model.api);
    if (!apiResult.success) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 必须设置受支持的 Pi API`);
    }
    const baseUrl = provider.options.baseURL.trim();
    if (!baseUrl && apiResult.data !== "bedrock-converse-stream") {
        throw new Error(`模型 ${providerConfigId}/${model.id} 缺少 Provider Base URL`);
    }
    if (model.reasoning === null) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 必须明确 reasoning 能力`);
    }
    if (!model.input?.length) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 必须声明输入能力`);
    }
    if (model.contextWindowTokens === null) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 必须设置 contextWindowTokens`);
    }
    if (model.maxTokens === null) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 必须设置 maxTokens`);
    }
    if (model.maxTokens > model.contextWindowTokens) {
        throw new Error(`模型 ${providerConfigId}/${model.id} 的 maxTokens 不能大于 contextWindowTokens`);
    }

    return {
        id: model.id,
        name: model.name || model.id,
        api: apiResult.data,
        provider: providerConfigId,
        providerConfigId,
        baseUrl,
        reasoning: model.reasoning,
        input: [...model.input],
        cost: resolvePiRuntimeCost(undefined, model.cost),
        contextWindow: model.contextWindowTokens,
        maxTokens: model.maxTokens,
        headers: Object.fromEntries(Object.entries(model.headers ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)),
        ...(model.compat ? {compat: model.compat as Model<Api>["compat"]} : {}),
        ...(model.thinkingLevelMap ? {thinkingLevelMap: model.thinkingLevelMap} : {}),
    };
}
