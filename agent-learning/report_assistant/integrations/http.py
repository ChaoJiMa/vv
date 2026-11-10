"""Java 业务接口共用的 HTTP 请求与响应检查。

只负责校验网关、发送 POST、解开 Java 的 {code/status, data} 响应包装。
登录和报告模块各自持有客户端及请求参数；本模块不保存 token 或业务响应。
所有对外异常使用本地固定文案，避免 URL 查询串、请求头和服务端正文进入日志。
"""

from urllib.parse import urlsplit

import httpx


TEST_API_BASE_URL = "https://testopen.beironsign.com"


class ReportApiError(RuntimeError):
    """可由终端显示的业务异常；构造时必须使用本地文案，不拼接后端 msg。"""

    pass


def validate_gateway(base_url):
    """返回去掉尾部斜杠的 HTTPS 网关地址，拒绝内嵌账号和查询参数。

    这里做通用地址检查，不限定业务环境；test 模式的固定网关限制在登录模块。
    不把非法原地址拼进异常，因为地址可能误含 token 或其他敏感信息。
    """
    try:
        parsed = urlsplit(base_url)
        valid = (parsed.scheme == "https" and parsed.hostname and not parsed.query
                 and not parsed.fragment and not parsed.username and not parsed.password)
        # 访问 port 属性会触发非法端口格式校验，避免等到发请求时才暴露错误。
        parsed.port
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ReportApiError("REPORT_API_BASE_URL 必须是 HTTPS 业务网关，不能包含凭据或查询参数。")
    return base_url.rstrip("/")


def post_data(client, path, payload=None, *, params=None, operation="业务接口"):
    """发送 POST 并返回 data，统一处理 HTTP 状态、JSON 和业务成功码。

    payload 用于 Java @RequestBody 的 JSON 正文，params 用于 @RequestParam 参数。
    operation 由调用代码传入固定接口名称，仅用于定位失败阶段，不接收用户文本。
    HTTP 成功和业务成功分别校验；业务 code/status 为 200 才向上返回 data。
    """
    try:
        response = client.post(path, json=payload, params=params)
        response.raise_for_status()
    except httpx.HTTPStatusError:
        # 不转抛原始 HTTP 异常；其中可能携带带参数的 URL、请求和响应对象。
        raise ReportApiError(f"{operation}请求失败，请检查测试服务和账号权限。") from None
    except httpx.HTTPError:
        raise ReportApiError(f"{operation}连接失败，请检查测试网关地址和网络。") from None
    try:
        result = response.json()
    except ValueError:
        raise ReportApiError(f"{operation}未返回 JSON，请检查网关路由。") from None
    if not isinstance(result, dict):
        raise ReportApiError(f"{operation}响应格式错误。")
    # 兼容现有 Java 响应的 code/status 两种字段；有 code 时以 code 为准。
    # 不显示后端 msg/message，也不自动重试登录等可能消费验证码的请求。
    if result.get("code", result.get("status")) != 200:
        raise ReportApiError(f"{operation}拒绝请求，请检查验证码、登录有效期及当前账号权限。")
    return result.get("data")
