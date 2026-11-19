"""维护人员查看本机加密诊断；仅显示固定原因和统计元数据。"""

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
    "module_availability": "模块取值诊断",
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
AVAILABILITY_LABELS = {
    "missing": "未找到登记路径", "null": "空值", "empty": "空白或占位",
    "empty_collection": "空列表或空对象", "present": "已读取（可为容器）", "provided": "可展示",
    "display_hidden": "页面规则隐藏", "display_unconfirmed": "展示规则无法确认",
    "value_rejected": "值未通过投影检查", "detail_unconfirmed": "明细结构无法确认",
    "not_applicable": "无单独模块容器", "unexpected_type": "容器类型不符",
}
PERFORMANCE_COVERAGE_LABELS = {
    "not_projected": "未取得可统计的明细列表", "unconfirmed": "明细结构或内容无法确认",
    "no_records": "记录列表为空", "unreported": "各条记录均未填写",
    "partial": "部分记录有内容", "complete": "各条记录均有内容",
}
PERFORMANCE_ROW_LABELS = {
    "missing": "字段缺失", "null": "空值", "blank": "空白或占位",
    "recognized": "可识别的状态", "other_text": "未识别的文字", "numeric": "数值", "numeric_text": "数字字符串",
    "boolean": "布尔值", "filtered": "过滤后不可展示", "unexpected_shape": "结构不符",
}
RESTRICTION_DATE_KIND_LABELS = {"filing": "立案时间", "publication": "发布时间"}
RESTRICTION_DATE_GROUP_LABELS = {
    "ordinary": "普通限高", "open_case": "公开案件限高", "br": "百融限高", "br2": "百融限高二",
    "regional": "补充限高记录", "fyy": "FYY限高", "sfcx": "SFCX限高",
}
RESTRICTION_DATE_ROW_LABELS = {
    "missing": "字段缺失", "null": "空值", "blank": "空白或占位",
    "valid_date": "有效日期", "unrecognized": "有值但日期格式未确认", "unexpected_shape": "结构不符",
}


def display_performance(detail):
    """展示履行情况的分类统计与小结是否提到人工，不输出履行字段原文。"""
    review = "是" if detail["human_review"] else "否"
    print(f"    履行情况诊断｜小结提到人工客服={review}")
    for index, item in enumerate(detail["fields"], 1):
        source = AVAILABILITY_LABELS[item["source"]]
        result = AVAILABILITY_LABELS[item["result"]]
        coverage = PERFORMANCE_COVERAGE_LABELS[item["coverage"]]
        counts = '、'.join(f"{PERFORMANCE_ROW_LABELS[state]} {count} 条"
                          for state, count in sorted(item["rows"].items()))
        suffix = "（明细统计已截断）" if item["truncated"] else ""
        print(f"      字段 {index}｜正文={source}｜展示={result}｜覆盖={coverage}")
        if counts:
            print(f"      明细分类：{counts}{suffix}")


def display_restriction_dates(fields):
    """按来源组显示日期字段的逐条分类，避免容器存在被误读成每行有日期。"""
    print("    限高案件日期诊断")
    for item in fields:
        kind = RESTRICTION_DATE_KIND_LABELS[item["kind"]]
        group = RESTRICTION_DATE_GROUP_LABELS[item["group"]]
        source = AVAILABILITY_LABELS[item["source"]]
        result = AVAILABILITY_LABELS[item["result"]]
        counts = '、'.join(f"{RESTRICTION_DATE_ROW_LABELS[state]} {count} 条"
                          for state, count in sorted(item["rows"].items()))
        suffix = "（明细统计已截断）" if item["truncated"] else ""
        print(f"      {group}｜{kind}｜正文={source}｜展示={result}｜{counts or '暂无可统计明细'}{suffix}")


def display_module_availability(availability):
    """对照来源和展示状态的计数，帮助区分取不到值和转换未确认。"""
    print(f"  报告模板版本={availability['theme']}")
    for row in availability['modules']:
        block = AVAILABILITY_LABELS[row['block']]
        read = sum(row['source'].values())
        module = f"模块 {row['module_id']}" if row['module_id'] is not None else f"范围内第 {row['position']} 个模块"
        print(f"  {module}｜容器={block}｜登记字段={row['registered']}｜已检查字段={read}"
              f"｜展示规则未支持={row['unsupported_rules']}")
        for key, label in (('source', '正文取值'), ('result', '展示结果')):
            counts = '、'.join(f"{AVAILABILITY_LABELS[state]} {count} 项"
                              for state, count in sorted(row[key].items()))
            print(f"    {label}：{counts or '暂无可检查字段'}")
        if 'performance' in row:
            display_performance(row['performance'])
        if 'restriction_dates' in row:
            display_restriction_dates(row['restriction_dates'])


def display(records, *, summary_only=False):
    """按原因、范围和校验子类聚合；可只看汇总以便定位高频对话缺陷。"""
    if not records:
        print("尚无诊断记录。")
        return
    counts = Counter((record["reason"], record["route"],
                      record["validation"]["detail"] if record["validation"] else None,
                      record["validation"]["stage"] if record["validation"] else None,
                      record["validation"].get("subreason") if record["validation"] else None,
                      record["status_code"]) for record in records)
    print(f"最近 {len(records)} 条诊断：")
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
        if validation is not None and validation.get('evidence') is not None:
            display_evidence(validation['evidence'])
        if record.get('availability') is not None:
            display_module_availability(record['availability'])


def display_evidence(evidence):
    """展示已过白名单的角色对照，明确真假比较项，不把观察自动判为误拦。"""
    bounds = {'exact': '精确值', 'lower': '下限', 'upper': '上限',
              'strict_upper': '严格上限', 'unsupported': '不支持换算'}
    def quantity(value):
        amount = f"{value['months']}个月" if value['months'] is not None else '无法归一化'
        form = '中文' if value['form'] == 'chinese' else '数字'
        unit = '年' if value['unit'] == 'year' else '月'
        return f"{form}{unit}表述→{amount}/{bounds[value['bound']]}"
    print(f"  执行证据：模块/总结请求={evidence['request_count']}次，"
          f"耗时={evidence['elapsed_ms']}毫秒，已使用数字纠错={evidence['retry_used']}")
    for index, attempt in enumerate(evidence['attempts'], 1):
        cause = DURATION_SUBREASON_LABELS.get(attempt['subreason'], attempt['code'])
        print(f"  校验尝试{index}：{attempt['stage']}，批次={attempt['batch']}，"
              f"位置={attempt['position']}，原因={cause}")
        observation = attempt['observation']
        if observation is None:
            print('    本条件未采集时长角色对照。')
            continue
        print(f"    被拒段落长度={observation['text_length']}，所引来源={observation['source_count']}项，"
              f"回答统计周期={observation['answer_windows']}，证据截断={observation['truncated']}")
        for number, claim in enumerate(observation['claims'], 1):
            print(f"    回答时长{number}：{quantity(claim)}；同指标来源匹配={claim['same_metric_source']}；"
                  f"来源中存在同值同边界={claim['same_value_source']}")
        for number, source in enumerate(observation['sources'], 1):
            durations = '，'.join(quantity(value) for value in source['durations']) or '未提取到持续时长'
            print(f"    来源{number}({source['ref'] or '无引用'})：状态={source['status']}，"
                  f"类型={source['type']}，统计周期={source['windows']}"
                  f"（含周期={source['has_window']}）；{durations}")


def main():
    """从当前 Windows 用户的默认 DPAPI 历史库只读取独立诊断表。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=50, help="读取最近多少条诊断，1至100000")
    parser.add_argument("--summary-only", action="store_true", help="只看固定失败类别汇总")
    args = parser.parse_args()
    try:
        path = default_history_path()
        if not path.is_file():
            print("尚无诊断记录。")
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
