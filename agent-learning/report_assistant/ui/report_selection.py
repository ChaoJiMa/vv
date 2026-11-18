"""终端报告选择交互；只将当前页选项交给Java客户端复核，不接收任意报告ID。"""

from report_assistant.integrations.api import ReportApiError


def select_report(api, *, notice=""):
    """在终端分页选择报告，成功返回本地快照，退出或无报告时返回 None。

    用户只能输入当前页序号，不能直接输入任意 reportId。序号会映射为
    该页的报告标识，再交给 load_selected_report 复核和读取。notice 仅由调用代码
    传入固定提示，显示在列表之后，避免重刷列表时把上次失败原因挤出视野。
    """
    page = 1
    while True:
        data = api.list_my_reports(page)
        records = data["records"]
        print(f"\n我的报告：第 {page} 页，共 {data['total']} 份")
        for index, row in enumerate(records, 1):
            print(f"{index}. {row.get('title') or '报告'} | {row.get('reportCode') or row['reportId']} | {row.get('completedAtText') or ''}")
        if not records and data["total"] > 0:
            print("本页没有可选报告。")
        if notice:
            print(f"\n{notice}", flush=True)
            notice = ""
        if data["total"] == 0:
            print("当前账号暂无可用报告，请确认登录账号或联系人工客服。")
            return None
        choice = input("输入序号选择，n 下一页，p 上一页，exit 退出：").strip().lower()
        if choice in {"exit", "quit", "退出"}:
            return None
        if choice == "n":
            if page * 20 < data["total"]:
                page += 1
            else:
                notice = "已经是最后一页。"
        elif choice == "p":
            if page > 1:
                page -= 1
            else:
                notice = "已经是第一页。"
        elif choice.isdecimal() and 1 <= int(choice) <= len(records):
            selected_index = int(choice)
            print(f"已选择第 {selected_index} 项，正在复核并读取报告正文……", flush=True)
            try:
                return api.load_selected_report(page, records[selected_index - 1]["reportId"])
            except ReportApiError as error:
                # 刷新列表以反映报告可见性变化，随后显示固定异常文案再询问，
                # 使用户能在下一次输入前看到重选原因，不输出响应正文或报告值。
                notice = f"读取失败：{error} 请重新选择，或输入 exit 退出。"
        else:
            notice = "请输入当前页的报告序号（如 1），输入后按回车；退出请输入 exit。"
