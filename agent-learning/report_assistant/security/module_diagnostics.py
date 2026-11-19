"""模块取值诊断的封闭数据结构，不包含报告字段值或自由文本。"""

SOURCE_STATES = frozenset({"missing", "null", "empty", "empty_collection", "present"})
RESULT_STATES = frozenset({
    "provided", "missing", "null", "empty", "display_hidden", "display_unconfirmed",
    "value_rejected", "detail_unconfirmed",
})
BLOCK_STATES = SOURCE_STATES | {"not_applicable", "unexpected_type"}
MAX_MODULE_ID = 1000000
MAX_PERFORMANCE_ROWS = 256
MAX_RESTRICTION_DATE_ROWS = 256
PERFORMANCE_COVERAGE = frozenset({"not_projected", "unconfirmed", "no_records", "unreported", "partial", "complete"})
PERFORMANCE_ROW_STATES = frozenset({
    "missing", "null", "blank", "recognized", "other_text", "numeric", "numeric_text", "boolean",
    "filtered", "unexpected_shape",
})
RESTRICTION_DATE_KINDS = {
    "ordinary": frozenset({"filing", "publication"}),
    "open_case": frozenset({"filing"}),
    "br": frozenset({"publication"}),
    "br2": frozenset({"filing", "publication"}),
    "regional": frozenset({"filing"}),
    "fyy": frozenset({"publication"}),
    "sfcx": frozenset({"publication"}),
}
RESTRICTION_DATE_ROW_STATES = frozenset({
    "missing", "null", "blank", "valid_date", "unrecognized", "unexpected_shape",
})


def valid_module_availability(evidence, *, version=None):
    """读写共用白名单，限制模块数量、诊断计数和可落盘的键。"""
    def bounded_int(value, upper):
        return type(value) is int and 0 <= value <= upper

    def valid_counts(counts, allowed):
        return (isinstance(counts, dict) and counts.keys() <= allowed
                and all(bounded_int(count, 256) and count > 0 for count in counts.values()))

    def valid_performance(detail, read):
        if (not isinstance(detail, dict) or detail.keys() != {"fields", "human_review"}
                or type(detail["human_review"]) is not bool or not isinstance(detail["fields"], list)
                or not 1 <= len(detail["fields"]) <= read):
            return False
        for field in detail["fields"]:
            if (not isinstance(field, dict) or field.keys() != {"source", "result", "coverage", "rows", "truncated"}
                    or not isinstance(field["source"], str) or field["source"] not in SOURCE_STATES
                    or not isinstance(field["result"], str) or field["result"] not in RESULT_STATES
                    or not isinstance(field["coverage"], str) or field["coverage"] not in PERFORMANCE_COVERAGE
                    or not valid_counts(field["rows"], PERFORMANCE_ROW_STATES)
                    or type(field["truncated"]) is not bool):
                return False
            total = sum(field["rows"].values())
            if total > MAX_PERFORMANCE_ROWS or (field["truncated"] and total != MAX_PERFORMANCE_ROWS):
                return False
            if (total == 0) != (field["coverage"] in {"not_projected", "no_records"}):
                return False
        return True

    def valid_restriction_dates(fields, read):
        # 来源组和角色只接受封闭组合，字段计数沿用模块实际读取的字段数。
        if not isinstance(fields, list) or not 1 <= len(fields) <= read:
            return False
        for field in fields:
            if (not isinstance(field, dict) or field.keys() != {"kind", "group", "source", "result", "rows", "truncated"}
                    or not isinstance(field["group"], str) or field["group"] not in RESTRICTION_DATE_KINDS
                    or not isinstance(field["kind"], str) or field["kind"] not in RESTRICTION_DATE_KINDS[field["group"]]
                    or not isinstance(field["source"], str) or field["source"] not in SOURCE_STATES
                    or not isinstance(field["result"], str) or field["result"] not in RESULT_STATES
                    or not valid_counts(field["rows"], RESTRICTION_DATE_ROW_STATES)
                    or type(field["truncated"]) is not bool):
                return False
            total = sum(field["rows"].values())
            if (total > MAX_RESTRICTION_DATE_ROWS or (field["truncated"] and total != MAX_RESTRICTION_DATE_ROWS)
                    or (total and field["source"] != "present")):
                return False
        return True

    if (not isinstance(evidence, dict) or evidence.keys() != {"theme", "modules"}
            or not bounded_int(evidence["theme"], 10000)
            or not isinstance(evidence["modules"], list) or not 1 <= len(evidence["modules"]) <= 96):
        return False
    seen_positions, seen_ids = set(), set()
    has_performance, has_restriction_dates = False, False
    for row in evidence["modules"]:
        if not isinstance(row, dict):
            return False
        keys = {"position", "module_id", "block", "registered", "source", "result", "unsupported_rules"}
        if version != 4 and "performance" in row:
            keys.add("performance")
        if version in (None, 6) and "restriction_dates" in row:
            keys.add("restriction_dates")
        if (row.keys() != keys
                or not bounded_int(row["position"], 96) or row["position"] == 0 or row["position"] in seen_positions
                or row["module_id"] is not None
                and (not bounded_int(row["module_id"], MAX_MODULE_ID) or row["module_id"] in seen_ids)
                or not isinstance(row["block"], str) or row["block"] not in BLOCK_STATES
                or not bounded_int(row["registered"], 100000)
                or not valid_counts(row["source"], SOURCE_STATES)
                or not valid_counts(row["result"], RESULT_STATES)):
            return False
        read = sum(row["source"].values())
        if (not read == sum(row["result"].values()) <= min(256, row["registered"])
                or not bounded_int(row["unsupported_rules"], read)
                or "performance" in row and not valid_performance(row["performance"], read)
                or "restriction_dates" in row and not valid_restriction_dates(row["restriction_dates"], read)):
            return False
        has_performance |= "performance" in row
        has_restriction_dates |= "restriction_dates" in row
        seen_positions.add(row["position"])
        if row["module_id"] is not None:
            seen_ids.add(row["module_id"])
    return (version != 5 or has_performance) and (version != 6 or has_restriction_dates)
