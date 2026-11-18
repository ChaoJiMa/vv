"""供全部入口共用的敏感日志关闭策略；导入时不修改日志配置。"""

import logging


def configure_private_logging():
    """关闭业务 HTTP 和模型 SDK 的敏感调试日志，在任何网络请求前执行。"""
    # 不让 SDK/HTTP 调试日志打印 token、请求头、异常正文或业务响应。
    roots = ("httpx", "httpcore", "zai", "openai")
    # 子 logger 可能已有自己的 handler；仅关闭父 logger 的传播拦不住它。
    names = set(roots) | {
        name for name in logging.root.manager.loggerDict
        if any(name.startswith(root + ".") for root in roots)
    }
    for name in names:
        logger = logging.getLogger(name)
        logger.handlers = [logging.NullHandler()]
        logger.setLevel(logging.CRITICAL + 1)
        logger.propagate = False
        logger.disabled = True
