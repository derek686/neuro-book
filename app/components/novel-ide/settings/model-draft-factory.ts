import type {
    ConfiguredModelDto,
    DiscoveredProviderModelDto,
    ModelCatalogEntryDto,
} from "nbook/shared/dto/app-settings.dto";

export type ModelDraftSource = "discovery" | "catalog" | "incomplete";

export type ResolvedModelDraft = {
    model: ConfiguredModelDto;
    source: ModelDraftSource;
    canonicalSource: string | null;
    missingFields: string[];
};

/**
 * 将前端临时发现结果转换成完整模型配置。
 * 远程能力不完整时整块替换为 Model Catalog，不进行逐字段拼接。
 */
export function resolveDiscoveredModelDraft(
    discovered: DiscoveredProviderModelDto,
    catalogModel: ModelCatalogEntryDto | null,
    providerApi: string | null,
): ResolvedModelDraft {
    const remoteMissing = requiredModelFields(discovered);
    if (remoteMissing.length === 0) {
        return {
            model: {...discovered, enabled: true},
            source: "discovery",
            canonicalSource: null,
            missingFields: [],
        };
    }
    if (catalogModel) {
        return {
            model: configuredModelFromCatalog(catalogModel, {
                id: discovered.id,
                name: catalogModel.name,
                group: discovered.group,
                enabled: true,
                providerApi,
            }),
            source: "catalog",
            canonicalSource: catalogModel.canonicalSource,
            missingFields: [],
        };
    }
    return {
        model: {...discovered, enabled: false},
        source: "incomplete",
        canonicalSource: null,
        missingFields: remoteMissing,
    };
}

/**
 * 从唯一标准 Model Catalog 创建完整、自包含的用户模型快照。
 * Catalog 添加、发现回填和“重新应用 Catalog”必须共用此 factory。
 */
export function configuredModelFromCatalog(
    catalogModel: ModelCatalogEntryDto,
    input: {id?: string; name?: string; group?: string | null; enabled: boolean; providerApi: string | null},
): ConfiguredModelDto {
    const api = input.providerApi || catalogModel.defaultApi;
    return {
        name: input.name ?? catalogModel.name,
        id: input.id ?? catalogModel.id,
        group: input.group ?? null,
        enabled: input.enabled,
        api,
        reasoning: catalogModel.reasoning,
        input: [...catalogModel.input],
        maxTokens: catalogModel.maxTokens,
        cost: catalogModel.cost ? {...catalogModel.cost, tiers: catalogModel.cost.tiers.map((tier) => ({...tier}))} : null,
        compat: catalogModel.compatByApi[api] ?? null,
        headers: catalogModel.headersByApi[api] ?? null,
        thinkingLevelMap: catalogModel.thinkingLevelMap ? {...catalogModel.thinkingLevelMap} : null,
        contextWindowTokens: catalogModel.contextWindowTokens,
    };
}

/** 返回模型启用前必须补齐的字段。 */
export function requiredModelFields(model: Pick<ConfiguredModelDto, "api" | "reasoning" | "input" | "contextWindowTokens" | "maxTokens">): string[] {
    const missing: string[] = [];
    if (!model.api) missing.push("api");
    if (model.reasoning === null) missing.push("reasoning");
    if (!model.input?.length) missing.push("input");
    if (model.contextWindowTokens === null) missing.push("contextWindowTokens");
    if (model.maxTokens === null) missing.push("maxTokens");
    if (model.contextWindowTokens !== null && model.maxTokens !== null && model.maxTokens > model.contextWindowTokens) {
        missing.push("maxTokens<=contextWindowTokens");
    }
    return missing;
}
