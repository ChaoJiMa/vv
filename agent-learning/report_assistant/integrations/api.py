"""调用 Java 现有报告接口，按登录身份选择并读取报告。

ReportApi.from_env 取得 Java 登录 token 后，先查“我的报告”分页列表，
由终端用户选定 reportId，再复核列表并获取报告正文。Python 不直接连接报告库，
也不允许模型传入其他用户身份；后端仍必须逐次检查 token 和报告访问权限。
"""

import os

import httpx

from report_assistant.integrations.auth import login_from_env
from report_assistant.integrations.http import ReportApiError, post_data, validate_gateway


# 两个接口由同一业务网关转发到不同 Java 服务，因此保留各自服务前缀。
MY_REPORTS_PATH = "/report-server/my-report/query-user/page"
REPORT_DATA_PATH = "/core/mobile/report/getReportData"


class ReportApi:
    """持有当前业务 token 的报告客户端，与模型 HTTP 客户端分别创建和关闭。"""

    def __init__(self, base_url, token, transport=None):
        """绑定已登录身份；transport 只用于注入测试传输，不改变请求协议。"""
        base_url = validate_gateway(base_url)
        if not isinstance(token, str) or not token.strip():
            raise ReportApiError("缺少业务登录凭证，请先通过手机号登录。")
        # Java 网关读取的是 token 请求头，不是模型接口的 Authorization: Bearer。
        # 所有报告请求复用此客户端，因此分页与正文查询始终使用同一份登录凭证。
        self.client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"token": token.strip(), "type": "3", "isShareQuery": "0"},
            timeout=30.0,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    @classmethod
    def from_env(cls, transport=None):
        """优先复用 REPORT_USER_TOKEN，留空时调用 Java 登录流程获取新凭证。

        自动登录得到的 token 只传给客户端构造函数，不写入 .env 或环境变量。
        显式配置的旧 token 若失效，会报错提示；这里不自动切换账号或静默重登。
        """
        base_url = validate_gateway(os.getenv("REPORT_API_BASE_URL", "").strip())
        token = os.getenv("REPORT_USER_TOKEN", "").strip()
        if not token:
            token = login_from_env(base_url, transport)
        return cls(base_url, token, transport)

    def close(self):
        """释放报告查询连接，由 main 的 ExitStack 保证退出时调用。"""
        self.client.close()

    def _post(self, path, payload):
        """沿用当前 token 请求，以固定阶段名称区分列表与正文错误，不显示后端消息。"""
        operation = "报告列表接口" if path == MY_REPORTS_PATH else "报告正文接口"
        return post_data(self.client, path, payload, operation=operation)

    def list_my_reports(self, page=1):
        """查询当前 token 对应用户的报告，返回已校验的 records 和 total。

        Java 接收 page/size 的 JSON 正文，页码从 1 开始，每页固定 20 条。
        不接受 userId 筛选；用户身份交由后端从 token 中确定。
        """
        # bool 在 Python 中也是 int 的子类；用精确类型避免把 True 当作第 1 页。
        if type(page) is not int or page < 1:
            raise ReportApiError("报告页码必须是正整数。")
        data = self._post(MY_REPORTS_PATH, {"page": page, "size": 20})
        if not isinstance(data, dict) or not isinstance(data.get("records"), list):
            raise ReportApiError("我的报告分页响应格式错误。")
        # 列表展示和选中后的复核都依赖 reportId，缺少标识时不能继续拼正文请求。
        records = data["records"]
        if not all(isinstance(row, dict) and isinstance(row.get("reportId"), str) and row["reportId"] for row in records):
            raise ReportApiError("我的报告列表缺少报告 ID。")
        if type(data.get("total")) is not int or data["total"] < 0:
            raise ReportApiError("我的报告分页缺少有效总数。")
        return data

    def load_selected_report(self, page, report_id):
        """复核所选报告仍在当前用户列表中，然后取正文并转换为本地工具格式。

        page/report_id 来自用户刚才选择的列表。再次请求列表可以发现选择期间
        报告被删除或变为不可见的情况；客户端复核不能代替正文接口的后端授权。
        """
        records = self.list_my_reports(page)["records"]
        record = next((row for row in records if row["reportId"] == report_id), None)
        if record is None:
            raise ReportApiError("该报告已不在当前登录用户的列表中，请重新选择。")
        data = self._post(REPORT_DATA_PATH, {"reportId": report_id})
        if not isinstance(data, dict) or not isinstance(data.get("report"), dict):
            raise ReportApiError("报告正文尚未就绪，或当前报告类型暂不支持。")
        # 列表使用 reportId，正文返回 report_id；必须一致才绑定到本地会话，
        # 避免网关、缓存或服务返回错报告时继续展示另一份数据。
        if data.get("report_id") != report_id:
            raise ReportApiError("报告正文 ID 与所选报告不一致，已停止读取。")
        # 统一为 LocalReportTools 接收的订单结构。report_data 保留 Java 返回的
        # 正文与模板快照；后续问答按这个快照取值，不会每问一句就重新请求正文。
        return {
            "order_id": data.get("user_info_id") or record.get("orderId"),
            "report_id": report_id,
            "is_demo": False,
            "note": "当前登录用户选择的报告；数据为选择时从测试业务接口读取的快照。",
            "value_source": "测试业务接口 /core/mobile/report/getReportData；后端读取 MongoDB report_data 并装配返回",
            "report_data": data,
        }
