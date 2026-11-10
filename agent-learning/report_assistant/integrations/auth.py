"""调用 Java 现有 H5 接口完成手机号登录。

测试模式的调用顺序是：测试网关生成通用验证码 -> Java H5 登录 -> 返回 token。
短信模式直接使用已有验证码调用同一个登录接口，不负责发送短信或处理滑块。
验证码校验、业务用户识别和 token 签发由 Java 服务处理；Python 负责组织请求、
检查响应格式并返回凭证，不自行生成 token，也不直接读写用户数据库。
"""

from getpass import getpass
import os
import re

import httpx

from report_assistant.integrations.http import ReportApiError, TEST_API_BASE_URL, post_data, validate_gateway


# 路径包含网关的服务前缀：/report 转发验证码服务，/useragent 转发用户服务。
# base_url 只配置网关地址，避免在调用时重复拼接服务前缀。
TEST_CODE_PATH = "/report/openService/verify-code/sendGeneral"
LOGIN_PATH = "/useragent/bg/companyUser/login"


class ReportAuth:
    """登录专用客户端；成功后把 token 交给 ReportApi 创建报告查询客户端。"""

    def __init__(self, base_url, transport=None):
        """校验网关并创建客户端；transport 可注入内存传输供离线测试使用。"""
        self.base_url = validate_gateway(base_url)
        # 登录前没有业务 token，因此这里只带 H5 的公共请求头。
        # type=3 表示 H5；isShareQuery=0 沿用 H5 普通查询请求头约定。
        # 禁止自动重定向，避免手机号和验证码被转发到另一个地址；
        # trust_env=False 避免继承环境代理设置，超时则交给上层显示固定提示。
        self.client = httpx.Client(
            base_url=self.base_url,
            headers={"type": "3", "isShareQuery": "0"},
            timeout=30.0, follow_redirects=False, trust_env=False,
            transport=transport,
        )

    def close(self):
        """释放登录连接；不持久化验证码、token 或登录响应。"""
        self.client.close()

    def login(self, mobile, *, mode="sms", sms_code="", test_user_name=""):
        """返回 Java 签发的 token，失败时抛出不含敏感响应的 ReportApiError。

        mobile 是业务账号手机号，两种模式必须使用同一个号码获取和校验验证码。
        test 模式自动获取验证码，test_user_name 是测试接口要求的联调标记；
        sms 模式使用 sms_code，不调用测试验证码接口。后端仍负责验证账号和凭证。
        """
        if mode not in {"test", "sms"}:
            raise ReportApiError("REPORT_LOGIN_MODE 只能是 test 或 sms。")
        if not isinstance(mobile, str) or not re.fullmatch(r"1[3-9][0-9]{9}", mobile.strip()):
            raise ReportApiError("请输入有效的 11 位登录手机号，或配置 REPORT_LOGIN_MOBILE。")
        mobile = mobile.strip()
        if mode == "test":
            # 该接口直接返回通用验证码，只允许访问固定测试网关。
            # 比较完整网关地址，不能仅凭域名包含 test 字样就启用测试流程。
            if self.base_url != TEST_API_BASE_URL:
                raise ReportApiError("test 登录模式仅允许连接 testopen.beironsign.com 测试网关。")
            if not isinstance(test_user_name, str) or not test_user_name.strip():
                raise ReportApiError("测试登录需要配置 REPORT_TEST_USER_NAME。")
            # Java 端使用 @RequestParam：这两个参数放在查询串中，POST 正文为空。
            # post_data 已解开响应外层的 {code, data}，此处拿到的就是 data 字符串。
            sms_code = post_data(self.client, TEST_CODE_PATH, params={
                "mobile": mobile, "testUserName": test_user_name.strip(),
            }, operation="测试验证码接口")
        # 两种来源的验证码都先做格式检查，避免将对象或空响应当作验证码提交。
        if not isinstance(sms_code, str) or not re.fullmatch(r"[0-9]{4,8}", sms_code.strip()):
            raise ReportApiError("登录验证码不可用；sms 模式请输入有效验证码，test 模式请检查测试验证码接口。")
        # Java 登录接口接收 JSON：type=3 是 H5 终端，registerType=3 是 H5 报告渠道。
        # 不传 userId 或跳过验证码校验的内部参数，身份以 Java 登录结果为准。
        data = post_data(self.client, LOGIN_PATH, {
            "mobile": mobile, "smsCode": sms_code.strip(), "type": 3, "registerType": 3,
        }, operation="登录接口")
        # 登录外层响应解包后，凭证位于 data.token；HTTP 200 本身不代表登录成功。
        # token 后续要放进 HTTP 请求头，只接受有限长度的可见 ASCII 字符，
        # 拒绝空值、对象及换行等控制字符。这里检查格式，不解析或替代后端鉴权。
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not re.fullmatch(r"[\x21-\x7e]{1,8192}", token.strip()):
            raise ReportApiError("登录接口未返回有效 token，请检查测试服务的登录响应。")
        return token.strip()


def login_from_env(base_url, transport=None):
    """读取登录配置并补齐终端输入，返回 token 给调用者，不写回环境或配置文件。

    main 已先加载本地 .env；这里统一从 os.environ 取值，保留终端环境变量优先级。
    未明确配置模式时使用 sms，自动获取测试验证码需要显式启用 test。
    """
    mode = os.getenv("REPORT_LOGIN_MODE", "sms").strip().lower()
    if mode not in {"test", "sms"}:
        raise ReportApiError("REPORT_LOGIN_MODE 只能是 test 或 sms。")
    # 输入手机号之前就拒绝错误的测试网关；ReportAuth.login 也保留同样检查，
    # 确保绕过本配置入口、直接调用登录类时仍受测试环境限制。
    if mode == "test" and validate_gateway(base_url) != TEST_API_BASE_URL:
        raise ReportApiError("test 登录模式仅允许连接 testopen.beironsign.com 测试网关。")
    mobile = os.getenv("REPORT_LOGIN_MOBILE", "").strip() or input("请输入登录手机号：").strip()
    test_user_name = os.getenv("REPORT_TEST_USER_NAME", "").strip()
    if mode == "test" and not test_user_name:
        test_user_name = input("请输入测试联调用户名：").strip()
    sms_code = ""
    if mode == "sms":
        # 验证码优先取本次配置；没有配置时用 getpass，避免普通终端输入回显。
        sms_code = os.getenv("REPORT_LOGIN_SMS_CODE", "").strip() or getpass("请输入已获取的登录验证码（不回显）：").strip()
    auth = ReportAuth(base_url, transport)
    try:
        return auth.login(mobile, mode=mode, sms_code=sms_code, test_user_name=test_user_name)
    finally:
        # 无论登录成功、响应异常还是网络失败，都及时释放专用登录连接。
        auth.close()
