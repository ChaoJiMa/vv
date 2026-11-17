"""维护人员查看本机加密的问答失败诊断；不读取或展示客户问题、答案及报告。"""

import argparse
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from report_assistant.integrations.history import HistoryError, HistoryStore, default_history_path


REASON_LABELS = {
    "timeout": "模型超时", "connection": "模型连接失败", "service": "模型服务不可用或拒绝",
    "incomplete": "模型回答不完整", "budget": "分析预算耗尽", "answer": "回答校验未通过",
    "payload": "请求内容校验未通过", "route": "问题路由格式未通过", "tool": "工具调用未通过",
    "facts": "报告事实校验未通过", "request_guard": "问题含受保护内容",
    "privacy_guard": "请求或工具内容校验未通过", "unexpected": "未分类运行异常",
    "model_disabled": "本轮未启用模型", "template_error": "模板选择失败",
    "local_projection": "本地事实投影失败",
    "fallback_no_fields": "模块预览没有可解读字段",
    "fallback_structured_value": "结构化结果只能给出简要提示",
    "fallback_projection_rejected": "模块预览事实投影被拒绝",
    "fallback_preview_limit": "所选模块超过预览数量上限",
    "local_privacy": "本地回退内容校验未通过",
    "local_processing_error": "本地回退处理失败",
    "local_unexpected": "本地回退发生未分类错误",
}
ROUTE_LABELS = {
    "template": "旧模板", "routing": "语义路由", "selected_modules": "所选模块",
    "full_report": "整份报告", "focused": "具体问题", "local_processing": "本地回退处理",
}
# 仅把经过 HistoryStore 白名单核对的时长子码译成固定说明；不展示异常原文。
DURATION_SUBREASON_LABELS = {
    "phone_source_missing": "缺少具名手机时长来源",
    "phone_role_mismatch": "同指标数值或范围角色不符",
    "phone_relation_unknown": "手机时长关系混入其他主体",
    "device_account_confusion": "设备使用时间与账户在网时长混淆",
    "number_reference_unconfirmed": "号码指代无法确认",
    "phone_source_wrong_subject": "手机时长来源用于其他主体",
    "composite_duration_interval": "复合时长区间无法核验",
    "composite_duration": "复合时长无法核验",
    "unverifiable_chinese_duration": "中文时长无法核验",
    "same_metric_boundary_changed": "同指标时长数值或边界改变",
    "chinese_duration_source_missing": "中文时长缺少同指标来源",
    "duration_boundary_changed": "时长范围边界改变",
}


def display(records, *, summary_only=False):
    """按原因、范围和校验子类聚合；可只看汇总以便定位高频对话缺陷。"""
    if not records:
        print("尚无失败诊断记录。")
        return
    counts = Counter((record["reason"], record["route"],
                      record["validation"]["detail"] if record["validation"] else None,
                      record["validation"]["stage"] if record["validation"] else None,
                      record["validation"].get("subreason") if record["validation"] else None,
                      record["status_code"]) for record in records)
    print(f"最近 {len(records)} 条失败诊断：")
    for (reason, route, validation_detail, stage, subreason, status), count in sorted(
            counts.items(), key=lambda item: (-item[1], str(item[0]))):
        detail = f"；{validation_detail}；阶段={stage}" if validation_detail else ""
        if subreason is not None:
            detail += f"；细因={DURATION_SUBREASON_LABELS[subreason]}"
        if status is not None:
            detail += f"；HTTP状态={status}"
        print(f"  {REASON_LABELS[reason]}｜{ROUTE_LABELS[route]}{detail}：{count}")
    if summary_only:
        return
    print("\n逐条记录（从新到旧）：")
    for record in records:
        validation = record["validation"]
        detail = f"；HTTP状态={record['status_code']}" if record["status_code"] is not None else ""
        if validation is not None:
            detail = (f"；校验：{validation['detail']}（类别={validation['code']}，"
                      f"阶段={validation['stage']}，批次={validation['batch']}，位置={validation['position']}）")
            if validation.get("subreason") is not None:
                detail += f"；细因={DURATION_SUBREASON_LABELS[validation['subreason']]}"
        print(f"{record['time']}｜{REASON_LABELS[record['reason']]}｜{ROUTE_LABELS[record['route']]}{detail}")


def main():
    """从当前 Windows 用户的默认 DPAPI 历史库只读取独立诊断表。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=50, help="读取最近多少条诊断，1至100000")
    parser.add_argument("--summary-only", action="store_true", help="只看固定失败类别汇总")
    args = parser.parse_args()
    try:
        path = default_history_path()
        if not path.is_file():
            print("尚无失败诊断记录。")
            return 0
        store = HistoryStore(path, readonly=True)
        try:
            display(store.read_diagnostics(args.limit), summary_only=args.summary_only)
        finally:
            store.close()
    except HistoryError:
        print("本机加密诊断暂时无法读取，请检查当前 Windows 用户和本地数据文件。", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
