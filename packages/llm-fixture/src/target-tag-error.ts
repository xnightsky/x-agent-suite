/**
 * @module @x-agent-suite/llm-fixture/target-tag-error
 * TargetTags 解析、资源定位与实例校验共用的错误类型。
 * 不变量：仅定义错误身份，不读取配置或发起网络请求。
 */

/** TargetTags 静态定义或实例校验错误。 */
export class TargetTagDefinitionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TargetTagDefinitionError";
  }
}
