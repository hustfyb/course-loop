// 故障 pi print 模式对端（仅测试用）：模拟 Pi 未配置 provider——stderr 输出错误并以非零码退出。
process.stderr.write('Error: Pi 未配置 provider：请先在 Pi 配置中设置模型提供方后重试\n');
process.exit(1);
