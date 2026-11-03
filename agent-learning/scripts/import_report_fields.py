"""从参考仓库同一 Git 提交导入全部报告主题的独立字段资料，不切换分支。"""

import argparse
import json
import re
import subprocess
from pathlib import Path


SOURCE_DIR = "docs/report-server/features/report-detail-ai/"
AUTHORITATIVE = SOURCE_DIR + "authoritative-all-themes-fields.json"
SUPPLEMENT = SOURCE_DIR + "rigorous-theme-core-modules.json"
OTHER_SUPPLEMENT = SOURCE_DIR + "other-themes-core-modules.json"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "report_fields.json"


def read_json(repo, revision, filename):
    """从指定本地 Git 提交读取资料，不切换分支、不触发 fetch 或远程请求。"""
    raw = subprocess.check_output(["git", "-C", str(repo), "show", f"{revision}:{filename}"])
    return json.loads(raw.decode("utf-8-sig"))


def walk_fields(value):
    """递归遍历 fields、sections 等结构，取得登记了展示名的字段。"""
    if isinstance(value, dict):
        if "displayName" in value:
            yield value
        for child in value.values():
            yield from walk_fields(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_fields(child)


def walk_paths(value):
    """收集 report 开头的登记路径，兼容单路径及按时间窗口分组的结构。"""
    if isinstance(value, str):
        if value.startswith(("report.", "report[")):
            yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from walk_paths(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_paths(child)


def build_catalog(authoritative, rigorous, other, source):
    """按主题、模块和路径合并通用资料，返回多主题目录，不执行文件或网络操作。

    权威表决定展示字段、前端规则和枚举。其他主题不继承严谨版后端口径；
    外观复用关系只记录为元数据，不参与跨主题匹配。冲突的补充口径不猜选。
    """
    supplements = {3: {"modules": rigorous["modules"], "effectiveThemeId": 3}}
    for theme in other["themes"]:
        theme_id = theme["themeId"]
        if type(theme_id) is not int or theme_id in supplements:
            raise ValueError("补充资料包含无效或重复的报告主题。")
        supplements[theme_id] = theme

    rows_by_theme = {}
    for row in authoritative["rows"]:
        match = re.fullmatch(r"(.+?)（theme=(\d+)）", row["主题"])
        if match is None or int(match.group(2)) not in supplements:
            raise ValueError("权威字段表的报告主题缺少有效补充资料。")
        theme_id = int(match.group(2))
        group = rows_by_theme.setdefault(theme_id, {"name": match.group(1), "rows": []})
        if group["name"] != match.group(1):
            raise ValueError("权威字段表包含冲突的主题名称。")
        group["rows"].append(row)

    catalogs = {}
    window_labels = rigorous["pathConventions"]["placeholders"]["windowLabel"]
    for theme_id, group in sorted(rows_by_theme.items()):
        supplement = supplements[theme_id]
        modules = {module["moduleId"]: module for module in supplement["modules"]}
        extra_fields = {}
        for module_id, module in modules.items():
            for field in walk_fields(module):
                paths = [field.get("reportDataPath"), field.get("reportDataPathsByWindow")]
                for path in set(walk_paths(paths)):
                    extra_fields.setdefault((module_id, path), []).append(field)

        # 分类缩写的中文名也只取当前主题的权威表，避免不同版本口径混用。
        category_labels = {}
        for row in group["rows"]:
            category = re.search(r"_APPLY_(P2P|XD|XFFQ|XJFQ|DCFQ|QT)_(COUNT|ORG_COUNT)$", row["报告数据字段路径"])
            if category:
                labels = category_labels.setdefault(row["模块ID"], {}).setdefault(category.group(1), {})
                labels[category.group(2)] = row["展示字段名称"]

        fields = []
        for row in group["rows"]:
            module_id = row["模块ID"]
            original_path = row["报告数据字段路径"]
            # 固定文案没有数据路径，不能把权威表的说明文字交给路径读取器。
            path = "" if not original_path or original_path.startswith("（静态文案") else original_path
            if path and not path.startswith(("report.", "report[")):
                raise ValueError("权威字段表包含无法识别的数据路径。")
            module = modules.get(module_id, {})
            candidates = extra_fields.get((module_id, path), [])
            named = [field for field in candidates if field.get("displayName") == row["展示字段名称"]]
            matches = named or candidates
            extra = matches[0] if len(matches) == 1 else {}
            window = re.search(r"_(D7|D15|M1|M3|M6|M12)_", path)
            module_rules = {
                key: module[key]
                for key in ("backendProcessor", "dataSource", "commonBackendRule", "totalCountRule", "initDefault")
                if key in module
            }
            if module_id in category_labels:
                module_rules["category_field_labels"] = category_labels[module_id]
            if theme_id == 3 and module_id == 5:
                module_rules["gaugeRules"] = rigorous["gaugeRules"]
            if theme_id == 3 and module_id in (58, 59):
                module_rules["gearRules"] = rigorous["gearRules"]
            source_files = module.get("sourceFiles", [module["component"]] if module.get("component") else [])
            fields.append({
                "module_id": module_id,
                "module_name": row["模块名称"],
                "name": row["展示字段名称"],
                "path": path,
                "window": window_labels.get(window.group(1), "") if window else "",
                "frontend_processing": row["前端处理逻辑"],
                "enum_mapping": row["枚举值映射"],
                "backend_processing": extra.get("backendProcessing", ""),
                "module_rules": module_rules,
                "source_files": extra.get("sourceFiles", source_files),
            })
        catalogs[str(theme_id)] = {
            "theme": theme_id,
            "theme_name": group["name"],
            "effective_theme": supplement.get("effectiveThemeId", theme_id),
            "fields": fields,
        }
    if not catalogs:
        raise ValueError("权威字段表没有可导入的主题。")
    return {
        "schema_version": 2,
        "source": {
            **source,
            "authoritative_file": AUTHORITATIVE,
            "supplement_files": [SUPPLEMENT, OTHER_SUPPLEMENT],
            "rule": "展示字段及前端逻辑以权威表为准；补充资料按同主题、同模块、同路径匹配，口径冲突不猜选。",
            "unverified": rigorous.get("unverified", []) + ["其他主题为通用字段资料导入，未逐一实连验证真实报告或执行网页全部展示计算。"],
        },
        "storage_note": rigorous["pathConventions"]["storage"],
        "themes": catalogs,
    }


def import_fields(repo, ref, output=OUTPUT):
    """固定 Git 提交后导入全部主题，返回目录；不读取用户报告、不自动 fetch。"""
    revision = subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", f"{ref}^{{commit}}"], text=True
    ).strip()
    payload = build_catalog(
        read_json(repo, revision, AUTHORITATIVE),
        read_json(repo, revision, SUPPLEMENT),
        read_json(repo, revision, OTHER_SUPPLEMENT),
        {"repository": "vibecoding-workspace", "ref": ref, "revision": revision},
    )
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    # 只写通用字段资料；按 UTF-8/LF 输出，保证 Windows 与其他系统重导入结果一致。
    # 运行中的报告工具保留自己的快照，更新后需要重启。
    output.write_bytes((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    total = sum(len(theme["fields"]) for theme in payload["themes"].values())
    print(f"已导入 {len(payload['themes'])} 个报告主题、{total} 条字段定义，来源提交 {revision[:12]}。")
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path, help="参考仓库所在目录")
    parser.add_argument("--ref", default="origin/report-server")
    args = parser.parse_args()
    import_fields(args.repo, args.ref)
